/**
 * /api/history-fill?name=<showName>&fromDate=<YYYY-MM-DD>&baselineCount=<N>&openDate=<YYYY-MM-DD>
 *
 * Builds a cumulative ticket count series by scanning orders day-by-day
 * from fromDate to today. Returns [{d, c}] relative to openDate, starting
 * from baselineCount and incrementing by tickets ordered each day.
 *
 * Maxes out at 60 days of history to keep response times reasonable.
 * Uses the same month-batched Spektrix order approach as ticket-mix.
 */

import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
// Cache for 4 hours — historical data doesn't change
export const revalidate = 14400;

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
    const event = events.find(e => e.name?.toLowerCase() === showName.toLowerCase());
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const today = new Date().toISOString().slice(0, 10);
    const scanFrom = fromDate > today ? today : fromDate;

    // Cap the scan so a long gap can't hang the request. 120 days covers the
    // usual distance between a season export and today; 60 did not, and The
    // Father's gap (2026-06-02 onward) fell straight through it.
    const maxScanEnd = addDays(scanFrom, 120);
    const scanTo = today < maxScanEnd ? today : maxScanEnd;
    const truncated = scanTo < today;

    const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;

    // Collect ticket counts by order date (YYYY-MM-DD)
    const byDay = {};        // { '2026-06-03': 12, ... }
    let page = 1;

    while (true) {
      const url = `${base}/orders?DateFrom=${scanFrom}&DateTo=${scanTo}&page=${page}&pageSize=200`;
      const res = await fetch(url, { headers: spektrixSign('GET', url) });
      if (!res.ok) break;
      if (!(res.headers.get('content-type') || '').includes('json')) break;
      const orders = await res.json();
      if (!Array.isArray(orders) || orders.length === 0) break;

      for (const order of orders) {
        // Order date: createdAt or purchasedAt — use whichever is available
        const rawDate = order.createdAt || order.purchasedAt || order.date || '';
        const orderDate = rawDate.slice(0, 10);
        if (!orderDate || orderDate < scanFrom || orderDate > scanTo) continue;

        for (const t of order.tickets || []) {
          if (t.event?.id === event.id) {
            byDay[orderDate] = (byDay[orderDate] || 0) + 1;
          }
        }
      }

      if (orders.length < 200) break;
      page++;
    }

    // Build cumulative series from baseline
    const series = [];
    let cumulative = baselineCount;
    let d = daysBetween(openDate, scanFrom);

    let cur = scanFrom;
    while (cur <= scanTo) {
      cumulative += (byDay[cur] || 0);
      // Only emit a point if something changed or it's a milestone
      const newD = daysBetween(openDate, cur);
      if (byDay[cur] || series.length === 0) {
        series.push({ d: newD, c: cumulative });
      }
      cur = addDays(cur, 1);
    }

    // Close the series at today only when the scan actually reached today.
    // Stamping the cumulative-as-of-scanTo onto today's date understates the
    // count, and — because it lands on the same day number as the live
    // availability point — it used to suppress that point instead of being
    // replaced by it. When truncated, the series simply ends at scanTo and the
    // caller appends the true live total.
    const todayD = daysBetween(openDate, today);
    if (!truncated && (!series.length || series[series.length - 1].d !== todayD)) {
      series.push({ d: todayD, c: cumulative });
    }

    return NextResponse.json({ series, total: cumulative, scanFrom, scanTo, truncated });
  } catch (err) {
    console.error('history-fill error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
