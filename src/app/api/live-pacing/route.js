import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';
import { spektrixGetAll } from '@/lib/spektrix';

// Always fresh — this is the "live" endpoint
export const dynamic = 'force-dynamic';

const GN_EVENT_ID = '1001ADGKSHLJDTDBJQTBMGLLJRLBJCMNN';

/**
 * Count net paid tickets for a specific event confirmed after baselineDate.
 * Mirrors the movement-report methodology: paid tickets (originalPrice > 0),
 * comps excluded, no reservation filtering needed since orders already
 * reflect confirmed sales.
 */
async function getDeltaTickets(eventId, baselineDate) {
  const today = new Date().toISOString().slice(0, 10);
  // Query one day before baseline to catch any same-day sales that might
  // have been just after the export was generated
  const fromDate = baselineDate;

  let page = 1;
  let delta = 0;

  while (true) {
    const path = `/orders?DateFrom=${fromDate}&DateTo=${today}&page=${page}&pageSize=200`;
    const orders = await spektrixGetAll.__proto__ === Object.prototype
      ? []
      : await (async () => {
          // Use raw fetch since spektrixGetAll doesn't support arbitrary paths well
          const { spektrixGet } = await import('@/lib/spektrix');
          return spektrixGet(path);
        })();

    if (!Array.isArray(orders) || orders.length === 0) break;

    for (const order of orders) {
      for (const t of order.tickets || []) {
        if (t.event?.id === eventId && t.originalPrice > 0) {
          delta++;
        }
      }
    }

    if (orders.length < 200) break;
    page++;
  }

  return delta;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName      = searchParams.get('name');
  const baselineDate  = searchParams.get('baselineDate');  // YYYY-MM-DD (last export date)
  const baselineCount = parseInt(searchParams.get('baselineCount') || '0', 10);
  const openDate      = searchParams.get('openDate');      // YYYY-MM-DD (opening night)

  if (!showName || !baselineDate || !openDate) {
    return NextResponse.json({ error: 'name, baselineDate and openDate required' }, { status: 400 });
  }

  try {
    // Look up Spektrix event ID by name
    const events = await getEvents();
    const event = events.find(
      (e) => e.name?.toLowerCase() === showName.toLowerCase()
    );
    if (!event) {
      return NextResponse.json({ error: `Event not found: ${showName}` }, { status: 404 });
    }

    // Paginate orders from baseline date to today and count new GN tickets
    const today = new Date().toISOString().slice(0, 10);
    let page = 1;
    let delta = 0;

    while (true) {
      const url = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3/orders?DateFrom=${baselineDate}&DateTo=${today}&page=${page}&pageSize=200`;
      const date = new Date().toUTCString();
      const crypto = (await import('crypto')).default;
      const sig = crypto
        .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
        .update(`GET\n${url}\n${date}`)
        .digest('base64');
      const res = await fetch(url, {
        headers: {
          Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`,
          Date: date,
        },
      });
      if (!res.ok) break;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('json')) break;
      const orders = await res.json();
      if (!Array.isArray(orders) || orders.length === 0) break;

      for (const order of orders) {
        for (const t of order.tickets || []) {
          if (t.event?.id === event.id && t.originalPrice > 0) {
            delta++;
          }
        }
      }

      if (orders.length < 200) break;
      page++;
    }

    // Compute today's d-value from opening date
    const open = new Date(openDate);
    open.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const d = Math.round((now - open) / 86400000);

    const c = baselineCount + delta;

    return NextResponse.json({ d, c, delta, baselineCount });
  } catch (err) {
    console.error('live-pacing error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
