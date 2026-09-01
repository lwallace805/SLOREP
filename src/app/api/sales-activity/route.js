/**
 * /api/sales-activity?days=30
 *
 * Net paid tickets sold per day, per show, across the whole season — the
 * "where are new sales landing this week" view, as opposed to the pacing page's
 * "how is one show tracking against its peers".
 *
 * This rides on the same order scan the gap fill uses. Fetching orders is the
 * expensive part and every order carries tickets for every show, so bucketing
 * them all costs one scan rather than one per show.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getEvents } from '@/lib/spektrix';
import { scanOrders, addDays } from '@/lib/historyFill';
import { pacificToday } from '@/lib/showStatus';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REQUEST_TIMEOUT_MS = 20000;
const SCAN_BUDGET_MS = 40000;
const CACHE_TTL_SECONDS = 900;
const ALLOWED_DAYS = [7, 30, 90];

function spektrixSign(url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`GET\n${url}\n${date}`)
    .digest('base64');
  return { Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`, Date: date };
}

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

async function runScan(scanFrom, scanTo) {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  // No eventId: bucket every show rather than filtering to one.
  return scanOrders({ eventId: null, scanFrom, scanTo, base, fetchPage, deadline: Date.now() + SCAN_BUDGET_MS });
}

const cachedScan = (scanFrom, scanTo) =>
  unstable_cache(
    () => runScan(scanFrom, scanTo),
    ['sales-activity', scanFrom, scanTo],
    { revalidate: CACHE_TTL_SECONDS, tags: ['sales-activity'] },
  )();

/** Every date in [from, to], so days with no sales still plot as zero. */
function dateRange(from, to) {
  const out = [];
  for (let cur = from, guard = 0; cur <= to && guard < 400; cur = addDays(cur, 1), guard++) out.push(cur);
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requested = parseInt(searchParams.get('days') || '30', 10);
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30;

  try {
    const today = pacificToday();
    const scanFrom = addDays(today, -(days - 1));
    const [events, scan] = await Promise.all([getEvents(), cachedScan(scanFrom, today)]);

    const nameById = new Map();
    for (const e of events || []) if (e?.id && e?.name) nameById.set(e.id, e.name);

    const dates = dateRange(scanFrom, today);
    const last7From = addDays(today, -6);
    const last30From = addDays(today, -29);

    const shows = Object.entries(scan.byEventDay || {})
      .map(([eventId, perDay]) => {
        const daily = dates.map(date => perDay[date] || 0);
        const sum = (fromDate) => dates.reduce(
          (n, date, i) => (date >= fromDate ? n + daily[i] : n), 0,
        );
        return {
          eventId,
          name: nameById.get(eventId) || 'Unknown event',
          daily,
          total: daily.reduce((a, b) => a + b, 0),
          last7: sum(last7From),
          last30: sum(last30From),
        };
      })
      .filter(s => s.total > 0)
      .sort((a, b) => b.last7 - a.last7 || b.total - a.total);

    return NextResponse.json({
      days, dates, shows,
      scanFrom, scanTo: today,
      complete: scan.complete,
      lastError: scan.lastError,
      uniqueOrders: scan.uniqueOrders,
    });
  } catch (err) {
    console.error('sales-activity error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
