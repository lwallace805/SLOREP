/**
 * /api/history-fill?name=<showName>&fromDate=<YYYY-MM-DD>&baselineCount=<N>&openDate=<YYYY-MM-DD>[&comps=0|1][&toDate=<YYYY-MM-DD>]
 *
 * Cumulative ticket counts per day between the last static export point and
 * today, so the pacing curve climbs rather than running flat and then jumping
 * on the day the live availability reading lands.
 *
 * comps=1 counts every seat, comps=0 (the default) net paid only, matching the
 * toggle on the pacing page. The page has sent this since the toggle landed,
 * but the route never read it: comps=0 and comps=1 answered byte for byte the
 * same, and the compTickets figure the page nets out of the live reading was
 * never in the response at all.
 *
 * The maths lives in src/lib/historyFill.js so it can be tested without
 * Spektrix — see scripts/test-history-fill.mjs.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getEvents, getEventsAround, findEvent } from '@/lib/spektrix';
import { scanOrders, buildSeries, scanWindow } from '@/lib/historyFill';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
// Order queries are the heaviest call in the app — moving live pacing onto the
// availability endpoint was done precisely to avoid them. Give this route room
// rather than letting the platform default cut a scan short.
export const maxDuration = 60;

// Per-request ceiling. Windows all run in one parallel wave, so this bounds the
// whole scan rather than stacking: a full 88-day run completes in about 18s.
// 12s was tight enough that a single contended window lost the race and dropped
// its week of data.
const REQUEST_TIMEOUT_MS = 20000;
// Overall budget, comfortably inside maxDuration. Past it the scan stops and
// answers with what it has, flagged incomplete. Being killed by the gateway
// returns nothing at all, which is strictly worse than a partial answer.
const SCAN_BUDGET_MS = 40000;

function spektrixSign(url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`GET\n${url}\n${date}`)
    .digest('base64');
  return { Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`, Date: date };
}

/** Returns { orders } on success, or { error } naming why it failed. */
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: spektrixSign(url), signal: controller.signal });
    if (!res.ok) return { error: `http ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return { error: `content-type ${type || 'none'}` };
    const body = await res.json();
    if (!Array.isArray(body)) return { error: 'body not an array' };
    return { orders: body };
  } catch (err) {
    return {
      error: err?.name === 'AbortError'
        ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
        : `fetch: ${err?.message || 'unknown'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runScan(eventId, scanFrom, scanTo, includeComps) {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  return scanOrders({ eventId, scanFrom, scanTo, base, fetchPage, includeComps, deadline: Date.now() + SCAN_BUDGET_MS });
}

// Past order counts do not change, so a successful scan is worth caching hard.
// A failed one is not: caching it pins a transient fault for four hours and
// makes it look permanent. Throw so nothing is stored, and hand the partial
// back for diagnostics.
// Fifteen minutes, for a complete scan and a partial one alike.
//
// Refusing to cache a partial result was meant to stop a transient failure being
// pinned for four hours. In practice the scan is nearly always marginally
// incomplete — one busy window hits its page ceiling — so nothing was ever
// cached and every page load re-ran a 20-40s scan with the curve sitting flat
// until it finished. That is what made the pacing curve look correct once and
// then wrong again on the next load.
//
// A short window is also better for freshness than the old four hours: the last
// few days of the curve move as tickets sell, and they now refresh on roughly
// the same cadence as the live figures.
const SCAN_TTL_SECONDS = 900;

async function scanWithCache(eventId, scanFrom, scanTo, includeComps) {
  try {
    return await unstable_cache(
      () => runScan(eventId, scanFrom, scanTo, includeComps),
      // v2: the scan now pages every window to its end. Keyed on the counting
      // basis too, so a comps=1 answer is never served to a comps=0 request.
      ['history-fill', 'v2', eventId, scanFrom, scanTo, includeComps ? 'comps' : 'paid'],
      { revalidate: SCAN_TTL_SECONDS, tags: ['history-fill'] },
    )();
  } catch (err) {
    const msg = err?.message || 'scan failed';
    return {
      byDay: {}, complete: false, ordersSeen: 0, uniqueOrders: 0,
      ticketsSeen: 0, matchedTickets: 0, compTickets: 0,
      lastError: msg, errors: [msg], incompleteWindows: [], windows: [],
    };
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName      = searchParams.get('name');
  const fromDate      = searchParams.get('fromDate');
  const baselineCount = parseInt(searchParams.get('baselineCount') || '0', 10);
  const openDate      = searchParams.get('openDate');
  // Net paid by default, as the pacing page's toggle is.
  const includeComps  = searchParams.get('comps') === '1';
  // Optional end, for rebuilding a closed show's series without scanning past
  // its closing night. Clamped to today either way.
  const toDate        = searchParams.get('toDate');

  if (!showName || !fromDate || !openDate) {
    return NextResponse.json({ error: 'name, fromDate, openDate required' }, { status: 400 });
  }

  try {
    // Spektrix lists only events with performances still to come, so a closed
    // show has to be looked up by the dates of its run.
    const events = await getEvents();
    const event = findEvent(events, showName) || findEvent(await getEventsAround(openDate), showName);
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found', showName, eventsSeen: events?.length ?? 0 },
        { status: 404 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const end = toDate && toDate < today ? toDate : today;
    const { scanFrom, scanTo, truncated } = scanWindow(fromDate, end);
    const scan = await scanWithCache(event.id, scanFrom, scanTo, includeComps);

    // The closing point goes on the end of the requested range. Stamping it on
    // today for a scan that was asked to stop at closing night put a closed
    // show's final two days past its last performance, where the page then
    // could not place the seat count on closing night either.
    const { series, total } = buildSeries({
      byDay: scan.byDay, baselineCount, openDate, scanFrom, scanTo, today: end, truncated,
    });

    return NextResponse.json({
      series, total, scanFrom, scanTo, truncated,
      complete: scan.complete,
      found: total - baselineCount,
      eventId: event.id,
      eventName: event.name,
      ordersSeen: scan.ordersSeen,
      uniqueOrders: scan.uniqueOrders,
      ticketsSeen: scan.ticketsSeen,
      matchedTickets: scan.matchedTickets,
      includeComps,
      compTickets: scan.compTickets ?? 0,
      lastError: scan.lastError,
      errors: scan.errors ?? [],
      // Windows that did not page to their end, with why. Their partial data
      // is still in the series; the windows that finished are not discarded.
      incompleteWindows: scan.incompleteWindows ?? [],
      ...(searchParams.get('debug') ? { shape: scan.shape, windows: scan.windows } : {}),
    });
  } catch (err) {
    console.error('history-fill error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
