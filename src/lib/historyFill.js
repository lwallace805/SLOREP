/**
 * Gap-fill maths for /api/history-fill, kept separate from the route so it can
 * be exercised without Spektrix. See scripts/test-history-fill.mjs.
 *
 * The job: between the last point of the static season export and today, work
 * out what actually sold each day by counting orders, so the pacing curve
 * climbs instead of running flat and then jumping on the day the live
 * availability reading lands.
 */

// 200 orders/page. Pages are fetched in waves of this many per window: page 1
// alone first, then this many at a time for any window whose last page came
// back full. It sizes a wave, not the scan.
export const MAX_PAGES_PER_MONTH = 8;
// Hard ceiling on pages for one window, 8,000 orders across four days. The
// ceiling used to be the wave size, eight pages, and a window that filled all
// eight was simply abandoned: the ceiling was noted and every order past page
// 8 dropped. The 8-11 July 2026 window (Finding Nemo's opening and the season
// allocations landing together) filled it on every run, and The Father's
// curve came back well short of the live seat count. A window still full at
// this bound is reported as such and the scan flagged incomplete, never
// silently short.
export const MAX_PAGES_PER_WINDOW = 40;
// A long gap is still bounded so one request cannot scan an entire season.
export const MAX_SCAN_DAYS = 120;

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// Orders are filtered server-side and the cost scales with how many fall in the
// window: a whole month exceeded a 12s request ceiling, while four days answered
// comfortably. Four days also keeps the June subscription rush inside the page
// ceiling and cuts how many windows a long-running order can touch. Windows all
// run in parallel, so more of them costs nothing in depth.
export const WINDOW_DAYS = 4;

/** Split [from, to] into consecutive windows of at most `days` days. */
export function dateWindows(from, to, days = WINDOW_DAYS) {
  if (to < from) return [];
  const out = [];
  let cur = from;
  for (let guard = 0; guard < 64 && cur <= to; guard++) {
    const end = addDays(cur, days - 1);
    out.push({ from: cur, to: end > to ? to : end });
    cur = addDays(end, 1);
  }
  return out;
}

// Comp ticket types, mirroring src/app/api/ticket-mix/route.js. A ticket is a
// comp by type or by carrying no original price.
export const COMP_TYPE_IDS = new Set([
  '601APNNMRMBJQQPBSCNQMHHCNMQSBHBBJ', // Artist Comp
  '801ARDQDDMGGJKKRTNTJBMCCMMBCPQKCR', // Sponsor Comps
  '1001ADGKSHLJDTDBJQTBMGLLJRLBJCMNN', // Volunteer Comp
  '1002AHCBPDSTCNNKTDJHKPNMKHJVQKHSQ', // General Comp
]);

/**
 * Whether a ticket counts towards the paid figure the dashboard reports.
 *
 * The page states the rule itself: net paid tickets only, comps excluded,
 * subscription bundles with $0 line items excluded. Counting every ticket with
 * a matching event id instead produced 1,159 against a live availability total
 * of 889 — a curve that climbed past the real figure and then dropped back to
 * it on the final point.
 */
export function isPaidTicket(t) {
  const typeId = t?.type?.id || t?.ticketType?.id || '';
  if (COMP_TYPE_IDS.has(typeId)) return false;
  if (t?.originalPrice === 0) return false;
  return true;
}

/** Paid tickets on this order belonging to eventId. Spektrix nests the event id
 *  under each ticket; some payloads carry it as a bare string rather than an
 *  object, so accept both rather than silently counting zero. */
export function countTicketsForEvent(order, eventId) {
  let n = 0;
  for (const t of order?.tickets || []) {
    const id = typeof t?.event === 'string' ? t.event : t?.event?.id;
    if (id && id === eventId && isPaidTicket(t)) n++;
  }
  return n;
}

/**
 * The day an order was placed.
 *
 * Spektrix names this firstTransactionDate. The original code looked for
 * createdAt / purchasedAt / date, none of which exist on an order, so this
 * returned '' for every order and the date-window guard skipped all of them
 * before matching ever ran — which is why 254 tickets carrying the right event
 * id still produced matchedTickets: 0. The local field is preferred over the
 * Utc one so days bucket against the theatre's calendar rather than sliding at
 * 5pm Pacific.
 */
export function orderDateOf(order) {
  const raw = order?.firstTransactionDate
    || order?.firstTransactionDateUtc
    || order?.lastTransactionDate
    || order?.createdAt || order?.purchasedAt || order?.date || '';
  return typeof raw === 'string' ? raw.slice(0, 10) : '';
}

/**
 * Count tickets per day for one event across [scanFrom, scanTo].
 *
 * `fetchPage(url)` must resolve to { orders } or { error }. `deadline` is an
 * epoch-ms cutoff: past it, remaining fetches are abandoned and the result is
 * returned incomplete, so the caller answers with a partial rather than being
 * killed mid-flight and returning nothing at all.
 *
 * Returns { byDay, complete, ordersSeen, ticketsSeen, matchedTickets, lastError,
 * errors, incompleteWindows, windows }. `complete` is true only when every
 * window ended on a short page with no failed fetch. `lastError` is the first
 * problem, kept for existing callers; `errors` has all of them and
 * `incompleteWindows` names each window that did not finish and why.
 */
export async function scanOrders({
  eventId, scanFrom, scanTo, base, fetchPage,
  maxPages = MAX_PAGES_PER_MONTH, maxPagesPerWindow = MAX_PAGES_PER_WINDOW,
  deadline = null, includeComps = false,
}) {
  const months = dateWindows(scanFrom, scanTo);
  const byDay = {};
  // Paid tickets per event per day. The orders fetch is the expensive part and
  // returns every event's tickets regardless, so bucketing them all costs
  // nothing beyond the filtering already being done. Pass no eventId to use the
  // scan purely for this.
  const byEventDay = {};
  // For the targeted show only: which performance each ticket was bought for,
  // by the day it was bought. Answers "today we sold three tickets to next
  // Thursday" — order date against performance, rather than either alone.
  // Only populated when an eventId is given, to bound the size.
  const byInstanceDay = {};
  let complete = true;
  let ordersSeen = 0;
  let ticketsSeen = 0;
  let matchedTickets = 0;
  // Comps counted, whether or not they are included in the buckets, so a view
  // can always say how much of a figure is papered rather than sold.
  let compTickets = 0;
  let lastError = null;
  // Every problem, not only the first. lastError kept the first message only,
  // so a second failing window was invisible.
  const errors = [];
  // Windows are contiguous, but Spektrix matches an order whose transactions
  // touch the range, and an order paid over several weeks touches several
  // windows. Counting its tickets once per window inflated the total well past
  // the real one and made it drift as more pages were fetched.
  const seenOrders = new Set();
  // Structural sample only — key names and event ids, never customer fields.
  // matchedTickets came back 0 against 254 real tickets, so the assumed shape
  // of a ticket is wrong and guessing again is not good enough.
  const shape = { ticketKeys: null, orderKeys: null, eventType: null, eventKeys: null, eventIds: [] };

  const url = (m, page) => `${base}/orders?DateFrom=${m.from}&DateTo=${m.to}&page=${page}&pageSize=200`;
  const expired = () => deadline != null && Date.now() > deadline;
  const note = (msg) => { complete = false; lastError = lastError || msg; errors.push(msg); };

  /** Ingest one page of orders. Returns { matched, fresh }: tickets matched
   *  to the target, and orders on the page not seen before. */
  function ingest(orders) {
    ordersSeen += orders.length;
    const matchedBefore = matchedTickets;
    let fresh = 0;
    for (const order of orders) {
      const oid = order?.id;
      if (oid) {
        if (seenOrders.has(oid)) continue;
        seenOrders.add(oid);
      }
      fresh++;
      const tix = order?.tickets || [];
      ticketsSeen += tix.length;
      if (!shape.orderKeys && order) shape.orderKeys = Object.keys(order).slice(0, 40);
      if (tix.length) {
        if (!shape.ticketKeys) shape.ticketKeys = Object.keys(tix[0]).slice(0, 40);
        for (const t of tix) {
          const ev = t?.event;
          if (ev != null && shape.eventType === null) {
            shape.eventType = typeof ev;
            if (typeof ev === 'object') shape.eventKeys = Object.keys(ev).slice(0, 20);
          }
          const id = typeof ev === 'string' ? ev : ev?.id;
          if (id && shape.eventIds.length < 8 && !shape.eventIds.includes(id)) shape.eventIds.push(id);
        }
      }
      const date = orderDateOf(order);
      if (!date || date < scanFrom || date > scanTo) continue;
      for (const t of tix) {
        const paid = isPaidTicket(t);
        const id = typeof t?.event === 'string' ? t.event : t?.event?.id;
        if (!id) continue;
        // Only comps for the show being asked about. Counting every show's
        // comps here made the figure meaningless the moment a scan was scoped
        // to one production. Counted whether or not they go in the buckets:
        // the pacing page nets this figure out of the live seat count in net
        // paid mode, and a net paid scan that reported 0 left it netting out
        // nothing, so the tile read 1,154 beside a curve that ended at 1,009.
        if (!paid && (!eventId || id === eventId)) compTickets++;
        if (!paid && !includeComps) continue;
        const perDay = byEventDay[id] || (byEventDay[id] = {});
        perDay[date] = (perDay[date] || 0) + 1;
        if (!eventId) { matchedTickets++; continue; }
        if (id !== eventId) continue;
        byDay[date] = (byDay[date] || 0) + 1;
        matchedTickets++;
        const iid = typeof t?.instance === 'string' ? t.instance : t?.instance?.id;
        if (iid) {
          const perInstance = byInstanceDay[iid] || (byInstanceDay[iid] = {});
          perInstance[date] = (perInstance[date] || 0) + 1;
        }
      }
    }
    return { matched: matchedTickets - matchedBefore, fresh };
  }

  const get = async (m, page) => {
    if (expired()) return { m, page, error: 'deadline reached' };
    const r = await fetchPage(url(m, page));
    return { m, page, ...r };
  };

  // Pages are fetched in waves rather than walked one after another. Paging
  // sequentially meant a window could cost maxPages round trips end to end,
  // which ran past the platform ceiling and returned 504 — the function was
  // never failing, only taking too long.
  //
  // The first wave probes page 1 of every window; most windows end there. Each
  // later wave fetches the next `maxPages` pages of every window whose last
  // page came back full, and keeps going until every window has returned a
  // short page. A window is not finished until it does: a full final page
  // used to be noted and then abandoned, which dropped everything past it.
  const windows = months.map(m => ({
    from: m.from, to: m.to, pages: 0, orders: 0, matched: 0,
    matchedByPage: [], status: 'open', errors: 0, endPage: null, repeated: false,
  }));
  const byKey = new Map(windows.map(w => [w.from, w]));
  const isOpen = w => w.status === 'open';

  while (windows.some(isOpen) && !expired()) {
    const tasks = [];
    for (const w of windows) {
      if (!isOpen(w)) continue;
      const first = w.pages + 1;
      const count = first === 1 ? 1 : maxPages;
      const last = Math.min(first + count - 1, maxPagesPerWindow);
      for (let p = first; p <= last; p++) tasks.push([w, p]);
    }
    const results = await Promise.all(tasks.map(([w, p]) => get({ from: w.from, to: w.to }, p)));
    // Pages are fetched in parallel but settled in order, so a short page
    // closes the window and anything fetched past it is still ingested.
    results.sort((a, b) => a.page - b.page);
    for (const { m, page, orders, error } of results) {
      const w = byKey.get(m.from);
      // A page abandoned at the deadline is reported once per window below,
      // not once per page, and does not count as fetched.
      if (error === 'deadline reached') continue;
      // Past the window's short page there is nothing: the rest of that wave
      // was already in flight, and a fault on an empty page is no fault.
      if (w.endPage != null && page > w.endPage) continue;
      w.pages = Math.max(w.pages, page);
      if (error) {
        // A failed page ends the window: paging on past a fault would spend
        // the budget on a window that is already incomplete, and a window
        // whose every page fails would otherwise fail forty times. Pages that
        // answered in the same wave are still ingested below.
        w.errors++;
        if (isOpen(w)) w.status = 'error';
        note(`${m.from}..${m.to} p${page}: ${error}`);
        continue;
      }
      const { matched, fresh } = ingest(orders);
      w.orders += orders.length;
      w.matched += matched;
      w.matchedByPage[page - 1] = matched;
      if (orders.length < 200 && isOpen(w)) { w.status = 'done'; w.endPage = page; }
      // Spektrix answers some windows with the same orders on every page: the
      // 8-11 July 2026 window returned 3,502 orders over 17 pages, 206 of them
      // distinct, and each of its four days alone fit on one short page. A
      // full page that adds nothing is the end of the window, not more of it;
      // paging on would burn the budget to the hard ceiling every time.
      if (fresh === 0 && page > 1 && isOpen(w)) { w.status = 'done'; w.endPage = page; w.repeated = true; }
    }
    for (const w of windows) {
      if (!isOpen(w)) continue;
      if (w.pages >= maxPagesPerWindow) {
        w.status = 'ceiling';
        note(`${w.from}..${w.to}: still full after ${maxPagesPerWindow} pages (${w.orders} orders); narrow the window`);
      }
    }
  }
  for (const w of windows) {
    if (isOpen(w)) {
      w.status = 'deadline';
      note(`${w.from}..${w.to}: deadline reached after page ${w.pages}`);
    }
  }
  const incompleteWindows = windows
    .filter(w => w.status !== 'done')
    .map(w => `${w.from}..${w.to}: ${w.status}`);

  return {
    byDay, byEventDay, byInstanceDay, complete, ordersSeen, ticketsSeen, matchedTickets, compTickets,
    lastError, errors, incompleteWindows, windows, shape, uniqueOrders: seenOrders.size,
  };
}

/**
 * Turn per-day counts into a cumulative series relative to openDate.
 *
 * The closing point at today is only emitted when the scan actually reached
 * today. Stamping the cumulative-as-of-scanTo onto today's date understates the
 * count, and lands on the same day number as the live availability point.
 */
export function buildSeries({ byDay, baselineCount, openDate, scanFrom, scanTo, today, truncated }) {
  const series = [];
  let cumulative = baselineCount;
  let cur = scanFrom;
  while (cur <= scanTo) {
    cumulative += (byDay[cur] || 0);
    if (byDay[cur] || series.length === 0) series.push({ d: daysBetween(openDate, cur), c: cumulative });
    cur = addDays(cur, 1);
  }
  const todayD = daysBetween(openDate, today);
  if (!truncated && (!series.length || series[series.length - 1].d !== todayD)) {
    series.push({ d: todayD, c: cumulative });
  }
  return { series, total: cumulative };
}

/** Clamp the requested window to today and to MAX_SCAN_DAYS. */
export function scanWindow(fromDate, today) {
  const scanFrom = fromDate > today ? today : fromDate;
  const maxScanEnd = addDays(scanFrom, MAX_SCAN_DAYS);
  const scanTo = today < maxScanEnd ? today : maxScanEnd;
  return { scanFrom, scanTo, truncated: scanTo < today };
}
