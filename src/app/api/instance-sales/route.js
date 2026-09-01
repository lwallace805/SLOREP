/**
 * /api/instance-sales?name=<showName>&days=14
 *
 * For one show: which performance each ticket was bought for, by the day it was
 * bought. "Today we sold three tickets to next Thursday" — order date against
 * performance date, rather than either on its own.
 *
 * The section above this on the page shows sales per day across the season, and
 * the table beside it shows how full each performance is. Neither says where
 * today's sales actually landed.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getEvents, findEvent, getInstanceAvailability } from '@/lib/spektrix';
import { scanOrders, addDays } from '@/lib/historyFill';
import { pacificToday } from '@/lib/showStatus';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REQUEST_TIMEOUT_MS = 20000;
const SCAN_BUDGET_MS = 40000;
const CACHE_TTL_SECONDS = 900;
const ALLOWED_DAYS = [7, 14, 30];

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

const cachedScan = (eventId, scanFrom, scanTo, includeComps) =>
  unstable_cache(
    () => {
      const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
      return scanOrders({ eventId, scanFrom, scanTo, base, fetchPage, includeComps, deadline: Date.now() + SCAN_BUDGET_MS });
    },
    ['instance-sales', eventId, scanFrom, scanTo, includeComps ? 'comps' : 'paid'],
    { revalidate: CACHE_TTL_SECONDS, tags: ['instance-sales'] },
  )();

function dateRange(from, to) {
  const out = [];
  for (let cur = from, guard = 0; cur <= to && guard < 400; cur = addDays(cur, 1), guard++) out.push(cur);
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName = searchParams.get('name');
  const requested = parseInt(searchParams.get('days') || '14', 10);
  const days = ALLOWED_DAYS.includes(requested) ? requested : 14;
  // Comps counted by default. The fill column beside these cells comes from
  // seat availability, which counts a comped seat like any other, so excluding
  // them here left the rows unable to reconcile with the percentage next door.
  const includeComps = searchParams.get('comps') !== '0';

  if (!showName) return NextResponse.json({ error: 'name required' }, { status: 400 });

  try {
    const events = await getEvents();
    const event = findEvent(events, showName);
    if (!event) return NextResponse.json({ error: 'Event not found', showName }, { status: 404 });

    const today = pacificToday();
    const scanFrom = addDays(today, -(days - 1));
    const [instances, scan] = await Promise.all([
      getInstanceAvailability(event.id),
      cachedScan(event.id, scanFrom, today, includeComps),
    ]);

    const dates = dateRange(scanFrom, today);
    const byInstance = scan.byInstanceDay || {};

    const performances = instances.map(inst => {
      const perDay = byInstance[inst.id] || {};
      const daily = dates.map(d => perDay[d] || 0);
      return {
        id: inst.id,
        dt: inst.dt,
        sold: inst.sold,
        cap: inst.cap,
        pct: inst.pct,
        past: inst.dt.slice(0, 10) < today,
        daily,
        windowTotal: daily.reduce((a, b) => a + b, 0),
      };
    });

    // Tickets whose instance we could not place against a known performance —
    // reported rather than quietly dropped, so the columns can be reconciled
    // against the day totals.
    const placed = performances.reduce((n, p) => n + p.windowTotal, 0);
    const totalInWindow = dates.reduce((n, d) => n + (scan.byDay?.[d] || 0), 0);

    return NextResponse.json({
      showName: event.name, eventId: event.id, days, dates, performances,
      includeComps, compTickets: scan.compTickets ?? 0,
      dailyTotals: dates.map(d => scan.byDay?.[d] || 0),
      totalInWindow, placed, unplaced: Math.max(0, totalInWindow - placed),
      complete: scan.complete, lastError: scan.lastError,
    });
  } catch (err) {
    console.error('instance-sales error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
