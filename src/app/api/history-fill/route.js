/**
 * /api/history-fill?name=<showName>&fromDate=<YYYY-MM-DD>&baselineCount=<N>&openDate=<YYYY-MM-DD>
 *
 * Cumulative ticket counts per day between the last static export point and
 * today, so the pacing curve climbs rather than running flat and then jumping
 * on the day the live availability reading lands.
 *
 * The maths lives in src/lib/historyFill.js so it can be tested without
 * Spektrix — see scripts/test-history-fill.mjs.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getEvents, findEvent } from '@/lib/spektrix';
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

async function runScan(eventId, scanFrom, scanTo) {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  return scanOrders({ eventId, scanFrom, scanTo, base, fetchPage, deadline: Date.now() + SCAN_BUDGET_MS });
}

// Past order counts do not change, so a successful scan is worth caching hard.
// A failed one is not: caching it pins a transient fault for four hours and
// makes it look permanent. Throw so nothing is stored, and hand the partial
// back for diagnostics.
async function scanWithCache(eventId, scanFrom, scanTo) {
  try {
    return await unstable_cache(
      async () => {
        const result = await runScan(eventId, scanFrom, scanTo);
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
  } catch (err) {
    return err.partial || {
      byDay: {}, complete: false, ordersSeen: 0, ticketsSeen: 0, matchedTickets: 0,
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
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found', showName, eventsSeen: events?.length ?? 0 },
        { status: 404 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const { scanFrom, scanTo, truncated } = scanWindow(fromDate, today);
    const scan = await scanWithCache(event.id, scanFrom, scanTo);

    const { series, total } = buildSeries({
      byDay: scan.byDay, baselineCount, openDate, scanFrom, scanTo, today, truncated,
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
      lastError: scan.lastError,
      ...(searchParams.get('debug') ? { shape: scan.shape } : {}),
    });
  } catch (err) {
    console.error('history-fill error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
