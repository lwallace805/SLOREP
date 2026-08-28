/**
 * /api/history-fill?name=<showName>&fromDate=<YYYY-MM-DD>&baselineCount=<N>&openDate=<YYYY-MM-DD>
 *
 * Builds a cumulative ticket count series by counting orders per day from
 * fromDate to today. Returns [{d, c}] relative to openDate, starting from
 * baselineCount and incrementing by tickets ordered each day.
 *
 * This fills the stretch between the last point in the static season export and
 * today. Without it the curve runs flat from the export date and then jumps
 * vertically on the day the live availability reading lands, which reads as
 * "every ticket sold this morning".
 *
 * Scanning is month-batched and run in parallel, the same shape ticket-mix uses,
 * because the previous single-window sequential page loop could take dozens of
 * round trips across an 88-day gap and time out. The client swallowed that
 * failure silently, which is precisely how the flat-then-cliff curve appeared.
 * When any batch fails or hits its page ceiling the response says so via
 * `complete: false` rather than presenting a short count as the whole truth.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getEvents, findEvent } from '@/lib/spektrix';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
// Order queries are the heaviest call in the app — moving live pacing onto the
// availability endpoint was done precisely to avoid them. Give this route room
// rather than letting the platform default cut a scan short.
export const maxDuration = 60;

// A generous ceiling, not a tight one. The first version aborted at 8s, which
// killed every month batch at once and returned ordersSeen: 0 — orders are slow
// enough that ticket-mix, the caller known to work, sets no timeout at all.
const REQUEST_TIMEOUT_MS = 25000;
// 200 orders/page. Six pages covers ~1200 orders in a month, comfortably above
// this theatre's volume, and bounds the worst case.
const MAX_PAGES_PER_MONTH = 6;
// A long gap is still bounded so one request cannot scan an entire season.
const MAX_SCAN_DAYS = 120;

function spektrixSign(method, url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`${method}\n${url}\n${date}`)
    .digest('base64');
  return {
    Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`,
    Date: date,
  };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/** Split [from, to] into whole-month windows, clipped to the range ends. */
function monthRanges(from, to) {
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

/** Returns { orders } on success, or { error } describing why it failed. */
async function fetchOrders(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: spektrixSign('GET', url), signal: controller.signal });
    if (!res.ok) return { error: `http ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return { error: `content-type ${type || 'none'}` };
    const body = await res.json();
    if (!Array.isArray(body)) return { error: 'body not an array' };
    return { orders: body };
  } catch (err) {
    return { error: err?.name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : `fetch: ${err?.message || 'unknown'}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tickets ordered per day for one event over [scanFrom, scanTo].
 * Returns { byDay, complete } — complete is false when any batch failed or hit
 * its page ceiling, so the caller can avoid passing a short count off as final.
 */
async function scanOrders(eventId, scanFrom, scanTo) {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  const byDay = {};
  let complete = true;
  // Counters so a zero result can be told apart from a failed one: no orders
  // returned at all is a different fault from orders returned whose tickets
  // never match this event id.
  let ordersSeen = 0;
  let ticketsSeen = 0;
  let lastError = null;

  await Promise.all(monthRanges(scanFrom, scanTo).map(async ({ from, to }) => {
    for (let page = 1; page <= MAX_PAGES_PER_MONTH; page++) {
      const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=${page}&pageSize=200`;
      const { orders, error } = await fetchOrders(url);
      if (error) { complete = false; lastError = lastError || `${from}..${to} p${page}: ${error}`; return; }
      if (!orders.length) return;

      ordersSeen += orders.length;
      for (const order of orders) {
        ticketsSeen += (order.tickets || []).length;
        const rawDate = order.createdAt || order.purchasedAt || order.date || '';
        const orderDate = rawDate.slice(0, 10);
        if (!orderDate || orderDate < scanFrom || orderDate > scanTo) continue;
        for (const t of order.tickets || []) {
          if (t.event?.id === eventId) byDay[orderDate] = (byDay[orderDate] || 0) + 1;
        }
      }

      if (orders.length < 200) return;
      if (page === MAX_PAGES_PER_MONTH) complete = false;
    }
  }));

  return { byDay, complete, ordersSeen, ticketsSeen, lastError };
}

// Past order counts do not change, so this is worth caching hard. The route
// itself must stay dynamic to read query params; caching the scan is what
// actually spares Spektrix. The previous `revalidate` export did nothing
// against `force-dynamic`, so every page load rescanned the whole gap.
const cachedScan = (eventId, scanFrom, scanTo) =>
  unstable_cache(
    async () => {
      const result = await scanOrders(eventId, scanFrom, scanTo);
      // Caching a failure pins it for four hours and makes a transient fault
      // look permanent — which is exactly what happened with the 8s timeout.
      // Throw so nothing is stored, and hand the partial back for diagnostics.
      if (!result.complete) {
        const err = new Error(result.lastError || 'scan incomplete');
        err.partial = result;
        throw err;
      }
      return result;
    },
    ['history-fill', eventId, scanFrom, scanTo],
    { revalidate: 14400, tags: ['history-fill'] },
  )();

async function scanWithCache(eventId, scanFrom, scanTo) {
  try {
    return await cachedScan(eventId, scanFrom, scanTo);
  } catch (err) {
    return err.partial || {
      byDay: {}, complete: false, ordersSeen: 0, ticketsSeen: 0,
      lastError: err?.message || 'scan failed',
    };
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName      = searchParams.get('name');
  const fromDate      = searchParams.get('fromDate');
  const baselineCount = parseInt(searchParams.get('baselineCount') || '0', 10);
  const openDate      = searchParams.get('openDate');

  if (!showName || !fromDate || !openDate) {
    return NextResponse.json({ error: 'name, fromDate, openDate required' }, { status: 400 });
  }

  try {
    const events = await getEvents();
    const event = findEvent(events, showName);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const today = new Date().toISOString().slice(0, 10);
    const scanFrom = fromDate > today ? today : fromDate;
    const maxScanEnd = addDays(scanFrom, MAX_SCAN_DAYS);
    const scanTo = today < maxScanEnd ? today : maxScanEnd;
    const truncated = scanTo < today;

    const { byDay, complete, ordersSeen, ticketsSeen, lastError } = await scanWithCache(event.id, scanFrom, scanTo);

    const series = [];
    let cumulative = baselineCount;
    let cur = scanFrom;
    while (cur <= scanTo) {
      cumulative += (byDay[cur] || 0);
      const newD = daysBetween(openDate, cur);
      if (byDay[cur] || series.length === 0) series.push({ d: newD, c: cumulative });
      cur = addDays(cur, 1);
    }

    // Close the series at today only when the scan actually reached today.
    // Stamping the cumulative-as-of-scanTo onto today's date understates the
    // count, and — because it lands on the same day number as the live
    // availability point — it used to suppress that point instead of being
    // replaced by it.
    const todayD = daysBetween(openDate, today);
    if (!truncated && (!series.length || series[series.length - 1].d !== todayD)) {
      series.push({ d: todayD, c: cumulative });
    }

    const found = cumulative - baselineCount;
    return NextResponse.json({
      series, total: cumulative, scanFrom, scanTo, truncated, complete, found,
      eventId: event.id, eventName: event.name, ordersSeen, ticketsSeen, lastError,
    });
  } catch (err) {
    console.error('history-fill error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
