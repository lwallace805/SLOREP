import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';

export const dynamic = 'force-dynamic';

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

async function countTicketsForEvent(eventId, fromDate, toDate) {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  let page = 1;
  let count = 0;

  while (true) {
    const url = `${base}/orders?DateFrom=${fromDate}&DateTo=${toDate}&page=${page}&pageSize=200`;
    const res = await fetch(url, { headers: spektrixSign('GET', url) });

    if (!res.ok) break;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) break;

    const orders = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) break;

    for (const order of orders) {
      for (const t of order.tickets || []) {
        // All committed seats: paid + comps + subscription allocations
        if (t.event?.id === eventId) count++;
      }
    }

    if (orders.length < 200) break;
    page++;
  }

  return count;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName      = searchParams.get('name');
  const baselineDate  = searchParams.get('baselineDate');  // YYYY-MM-DD
  const baselineCount = parseInt(searchParams.get('baselineCount') || '0', 10);
  const openDate      = searchParams.get('openDate');      // YYYY-MM-DD

  if (!showName || !baselineDate || !openDate) {
    return NextResponse.json({ error: 'name, baselineDate, openDate required' }, { status: 400 });
  }

  try {
    const events = await getEvents();
    const event = events.find((e) => e.name?.toLowerCase() === showName.toLowerCase());
    if (!event) {
      return NextResponse.json({ error: `Event not found: ${showName}` }, { status: 404 });
    }

    // Query orders from the day AFTER the baseline date to avoid double-counting
    // tickets already in the static series
    const [by, bm, bd] = baselineDate.split('-').map(Number);
    const fromMs = Date.UTC(by, bm - 1, bd) + 86400000; // baseline + 1 day
    const fromDate = new Date(fromMs).toISOString().slice(0, 10);

    // Use UTC date for "today" to be consistent with the d-value calculation
    const nowUtc = new Date();
    const toDate = new Date(Date.UTC(
      nowUtc.getUTCFullYear(),
      nowUtc.getUTCMonth(),
      nowUtc.getUTCDate()
    )).toISOString().slice(0, 10);

    const delta = await countTicketsForEvent(event.id, fromDate, toDate);

    // d-value: days from opening, using UTC dates throughout
    const [oy, om, od] = openDate.split('-').map(Number);
    const openUtcMs = Date.UTC(oy, om - 1, od);
    const nowUtcMs  = Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate());
    const d = Math.round((nowUtcMs - openUtcMs) / 86400000);

    return NextResponse.json({ d, c: baselineCount + delta, delta, baselineCount });
  } catch (err) {
    console.error('live-pacing error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
