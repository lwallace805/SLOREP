/**
 * Gap-fill maths for /api/history-fill, kept separate from the route so it can
 * be exercised without Spektrix. See scripts/test-history-fill.mjs.
 *
 * The job: between the last point of the static season export and today, work
 * out what actually sold each day by counting orders, so the pacing curve
 * climbs instead of running flat and then jumping on the day the live
 * availability reading lands.
 */

// 200 orders/page. Six pages covers ~1200 orders in a month, comfortably above
// this theatre's volume, and bounds the worst case.
export const MAX_PAGES_PER_MONTH = 8;
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
// comfortably. A week keeps each window under one 200-order page at this
// theatre's volume, and the windows all run in parallel anyway.
export const WINDOW_DAYS = 7;

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
 * Returns { byDay, complete, ordersSeen, ticketsSeen, matchedTickets, lastError }.
 */
export async function scanOrders({
  eventId, scanFrom, scanTo, base, fetchPage,
  maxPages = MAX_PAGES_PER_MONTH, deadline = null,
}) {
  const months = dateWindows(scanFrom, scanTo);
  const byDay = {};
  let complete = true;
  let ordersSeen = 0;
  let ticketsSeen = 0;
  let matchedTickets = 0;
  let lastError = null;
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
  const note = (msg) => { complete = false; lastError = lastError || msg; };

  function ingest(orders) {
    ordersSeen += orders.length;
    for (const order of orders) {
      const oid = order?.id;
      if (oid) {
        if (seenOrders.has(oid)) continue;
        seenOrders.add(oid);
      }
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
      const n = countTicketsForEvent(order, eventId);
      if (n) { byDay[date] = (byDay[date] || 0) + n; matchedTickets += n; }
    }
  }

  const get = async (m, page) => {
    if (expired()) return { m, page, error: 'deadline reached' };
    const r = await fetchPage(url(m, page));
    return { m, page, ...r };
  };

  // Pages are fetched in waves rather than walked one after another. Paging
  // sequentially meant a month could cost maxPages round trips end to end,
  // which ran past the platform ceiling and returned 504 — the function was
  // never failing, only taking too long. Two waves bound the depth instead.
  const wave1 = await Promise.all(months.map(m => get(m, 1)));
  const busy = [];
  for (const { m, orders, error } of wave1) {
    if (error) { note(`${m.from}..${m.to} p1: ${error}`); continue; }
    ingest(orders);
    if (orders.length >= 200) busy.push(m);
  }

  if (busy.length && maxPages > 1) {
    const tasks = [];
    for (const m of busy) for (let p = 2; p <= maxPages; p++) tasks.push([m, p]);
    const wave2 = await Promise.all(tasks.map(([m, p]) => get(m, p)));
    for (const { m, page, orders, error } of wave2) {
      if (error) { note(`${m.from}..${m.to} p${page}: ${error}`); continue; }
      ingest(orders);
      if (orders.length >= 200 && page === maxPages) note(`${m.from}..${m.to}: hit ${maxPages}-page ceiling`);
    }
  }

  return { byDay, complete, ordersSeen, ticketsSeen, matchedTickets, lastError, shape, uniqueOrders: seenOrders.size };
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
