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
export const MAX_PAGES_PER_MONTH = 6;
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

/** Split [from, to] into whole-month windows, clipped to the range ends. */
export function monthRanges(from, to) {
  if (to < from) return [];
  const out = [];
  let [y, m] = from.split('-').map(Number);
  for (let guard = 0; guard < 24; guard++) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mFrom = `${y}-${String(m).padStart(2, '0')}-01`;
    const mTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    out.push({ from: mFrom < from ? from : mFrom, to: mTo > to ? to : mTo });
    if (mTo >= to) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Tickets on this order belonging to eventId. Spektrix nests the event id
 *  under each ticket; some payloads carry it as a bare string rather than an
 *  object, so accept both rather than silently counting zero. */
export function countTicketsForEvent(order, eventId) {
  let n = 0;
  for (const t of order?.tickets || []) {
    const id = typeof t?.event === 'string' ? t.event : t?.event?.id;
    if (id && id === eventId) n++;
  }
  return n;
}

export function orderDateOf(order) {
  const raw = order?.createdAt || order?.purchasedAt || order?.date || '';
  return typeof raw === 'string' ? raw.slice(0, 10) : '';
}

/**
 * Walk the orders API month by month, in parallel, counting tickets per day.
 * `fetchPage(url)` must resolve to { orders } or { error }.
 * Returns { byDay, complete, ordersSeen, ticketsSeen, matchedTickets, lastError }.
 */
export async function scanOrders({ eventId, scanFrom, scanTo, base, fetchPage, maxPages = MAX_PAGES_PER_MONTH }) {
  const byDay = {};
  let complete = true;
  let ordersSeen = 0;
  let ticketsSeen = 0;
  let matchedTickets = 0;
  let lastError = null;

  await Promise.all(monthRanges(scanFrom, scanTo).map(async ({ from, to }) => {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=${page}&pageSize=200`;
      const { orders, error } = await fetchPage(url);
      if (error) {
        complete = false;
        lastError = lastError || `${from}..${to} p${page}: ${error}`;
        return;
      }
      if (!orders.length) return;
      ordersSeen += orders.length;

      for (const order of orders) {
        ticketsSeen += (order?.tickets || []).length;
        const date = orderDateOf(order);
        if (!date || date < scanFrom || date > scanTo) continue;
        const n = countTicketsForEvent(order, eventId);
        if (n) { byDay[date] = (byDay[date] || 0) + n; matchedTickets += n; }
      }

      if (orders.length < 200) return;
      if (page === maxPages) { complete = false; lastError = lastError || `${from}..${to}: hit ${maxPages}-page ceiling`; }
    }
  }));

  return { byDay, complete, ordersSeen, ticketsSeen, matchedTickets, lastError };
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
