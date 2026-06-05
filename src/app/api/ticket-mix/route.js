import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';
import { getPacificDateString } from '@/lib/livePacing';

export const dynamic = 'force-dynamic';

// Ticket type IDs → category
const COMP_TYPE_IDS = new Set([
  '601APNNMRMBJQQPBSCNQMHHCNMQSBHBBJ', // Artist Comp
  '801ARDQDDMGGJKKRTNTJBMCCMMBCPQKCR', // Sponsor Comps
  '1001ADGKSHLJDTDBJQTBMGLLJRLBJCMNN', // Volunteer Comp
  '1002AHCBPDSTCNNKTDJHKPNMKHJVQKHSQ', // General Comp
]);
const GROUP_TYPE_IDS = new Set([
  '2201AVBSMNJRLVSBVJRS', // Group
]);

function sign(url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`GET\n${url}\n${date}`)
    .digest('base64');
  return {
    Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`,
    Date: date,
  };
}

async function fetchOrdersPage(base, from, to, page) {
  const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=${page}&pageSize=200`;
  const res = await fetch(url, { headers: sign(url) });
  if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName = searchParams.get('name');
  if (!showName) return NextResponse.json({ error: 'name required' }, { status: 400 });

  try {
    const events = await getEvents();
    const event = events.find(e => e.name?.toLowerCase() === showName.toLowerCase());
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
    const today = getPacificDateString();

    // Build monthly ranges from 14 months before first instance to today
    const firstInst = new Date(event.firstInstanceDateTime);
    const startMs = firstInst.getTime() - 420 * 86400000; // 14 months back
    const startDate = new Date(startMs);
    const months = [];
    let cy = startDate.getUTCFullYear(), cm = startDate.getUTCMonth() + 1;
    const [ty, tm] = today.split('-').map(Number);
    while (cy < ty || (cy === ty && cm <= tm)) {
      const lastDay = new Date(cy, cm, 0).getDate();
      months.push({
        from: `${cy}-${String(cm).padStart(2, '0')}-01`,
        to: `${cy}-${String(cm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      });
      cm++; if (cm > 12) { cm = 1; cy++; }
    }

    const counts = { single: 0, subscription: 0, comp: 0, group: 0 };

    // Fetch in batches of 4 months
    const BATCH = 4;
    for (let i = 0; i < months.length; i += BATCH) {
      await Promise.all(months.slice(i, i + BATCH).map(async ({ from, to }) => {
        let page = 1;
        while (true) {
          const orders = await fetchOrdersPage(base, from, to, page);
          if (!orders.length) break;
          for (const order of orders) {
            const hasSub = (order.ticketSubscriptions || []).length > 0;
            for (const t of (order.tickets || [])) {
              if (t.event?.id !== event.id) continue;
              const typeId = t.type?.id || t.ticketType?.id || '';
              if (COMP_TYPE_IDS.has(typeId) || t.originalPrice === 0) {
                counts.comp++;
              } else if (GROUP_TYPE_IDS.has(typeId)) {
                counts.group++;
              } else if (hasSub) {
                counts.subscription++;
              } else {
                counts.single++;
              }
            }
          }
          if (orders.length < 200) break;
          page++;
        }
      }));
    }

    const total = counts.single + counts.subscription + counts.comp + counts.group;
    const pct = (n) => total > 0 ? Math.round(n / total * 1000) / 10 : 0;

    return NextResponse.json({
      showName: event.name,
      total,
      buckets: [
        { label: 'Single ticket', count: counts.single,       pct: pct(counts.single),       color: '#0F766E' },
        { label: 'Subscriber',    count: counts.subscription, pct: pct(counts.subscription), color: '#D97706' },
        { label: 'Group',         count: counts.group,        pct: pct(counts.group),        color: '#475569' },
        { label: 'Comp',          count: counts.comp,         pct: pct(counts.comp),         color: '#BBB1A0' },
      ],
    });
  } catch (err) {
    console.error('ticket-mix error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
