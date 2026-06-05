import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';

export const dynamic = 'force-dynamic';

// SLO Rep is in Pacific Time. Use the theater's local calendar date
// so d-values match what the team sees on the wall, not the UTC clock.
function getPacificDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // returns YYYY-MM-DD
}

function pacificDateToUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

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

    // Use Pacific Time for "today" — SLO Rep's local calendar date.
    // Prevents d flipping to 0 (opening) at 5 PM Pacific when UTC crosses midnight.
    const todayPacific = getPacificDateString(); // YYYY-MM-DD in Pacific time

    const delta = await countTicketsForEvent(event.id, fromDate, todayPacific);

    // d-value: Pacific calendar days from opening
    const openUtcMs   = pacificDateToUtcMs(openDate);
    const todayUtcMs  = pacificDateToUtcMs(todayPacific);
    const d = Math.round((todayUtcMs - openUtcMs) / 86400000);

    return NextResponse.json({ d, c: baselineCount + delta, delta, baselineCount });
  } catch (err) {
    console.error('live-pacing error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
