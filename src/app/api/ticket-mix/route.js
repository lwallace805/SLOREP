import crypto from 'crypto';
import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';
import { getPacificDateString } from '@/lib/livePacing';

export const revalidate = 300; // 5 minutes

const COMP_TYPE_IDS = new Set([
  '601APNNMRMBJQQPBSCNQMHHCNMQSBHBBJ', // Artist Comp
  '801ARDQDDMGGJKKRTNTJBMCCMMBCPQKCR', // Sponsor Comps
  '1001ADGKSHLJDTDBJQTBMGLLJRLBJCMNN', // Volunteer Comp
  '1002AHCBPDSTCNNKTDJHKPNMKHJVQKHSQ', // General Comp
]);
const GROUP_TYPE_IDS = new Set(['2201AVBSMNJRLVSBVJRS']);

function sign(url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`GET\n${url}\n${date}`)
    .digest('base64');
  return { Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`, Date: date };
}

async function fetchTicketMix(showName) {
  const events = await getEvents();
  const event = events.find(e => e.name?.toLowerCase() === showName.toLowerCase());
  if (!event) throw new Error('Event not found');

  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  const today = getPacificDateString();

  // Sample last 3 months only — 3 parallel calls, page 1 each (~1-2s total).
  const [ty, tm] = today.split('-').map(Number);
  const months = [];
  let cy = ty, cm = tm;
  for (let i = 0; i < 3; i++) {
    const last = new Date(cy, cm, 0).getDate();
    months.unshift({
      from: `${cy}-${String(cm).padStart(2, '0')}-01`,
      to: `${cy}-${String(cm).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    });
    cm--; if (cm < 1) { cm = 12; cy--; }
  }

  const counts = { single: 0, subscription: 0, group: 0, comp: 0 };

  await Promise.all(months.map(async ({ from, to }) => {
    const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=1&pageSize=200`;
    const res = await fetch(url, { headers: sign(url) });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return;
    const orders = await res.json();
    if (!Array.isArray(orders)) return;
    for (const order of orders) {
      const hasSub = (order.ticketSubscriptions || []).length > 0;
      for (const t of order.tickets || []) {
        if (t.event?.id !== event.id) continue;
        const typeId = t.type?.id || t.ticketType?.id || '';
        if (COMP_TYPE_IDS.has(typeId) || t.originalPrice === 0) counts.comp++;
        else if (GROUP_TYPE_IDS.has(typeId)) counts.group++;
        else if (hasSub) counts.subscription++;
        else counts.single++;
      }
    }
  }));

  const total = counts.single + counts.subscription + counts.group + counts.comp;
  const pct = n => total > 0 ? Math.round(n / total * 1000) / 10 : 0;

  return {
    showName: event.name,
    total,
    sample: true,
    buckets: [
      { label: 'Single ticket', count: counts.single, pct: pct(counts.single), color: '#0F766E' },
      { label: 'Subscriber', count: counts.subscription, pct: pct(counts.subscription), color: '#D97706' },
      { label: 'Group', count: counts.group, pct: pct(counts.group), color: '#475569' },
      { label: 'Comp', count: counts.comp, pct: pct(counts.comp), color: '#BBB1A0' },
    ],
  };
}

const getCachedTicketMix = unstable_cache(
  fetchTicketMix,
  ['ticket-mix'],
  { revalidate: 300, tags: ['ticket-mix'] }
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName = searchParams.get('name');
  if (!showName) return NextResponse.json({ error: 'name required' }, { status: 400 });

  try {
    const data = await getCachedTicketMix(showName);
    return NextResponse.json(data);
  } catch (err) {
    console.error('ticket-mix error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}