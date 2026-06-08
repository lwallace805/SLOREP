/**
 * Temporary diagnostic endpoint — shows raw Spektrix field names so we can
 * verify the instance ID format and matching logic.
 * DELETE after debugging is complete.
 */
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';

export const dynamic = 'force-dynamic';

function sign(url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`GET\n${url}\n${date}`)
    .digest('base64');
  return { Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`, Date: date };
}

export async function GET() {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;

  const events = await getEvents();
  const event = events.find(e => e.name?.toLowerCase().includes('grand night'));
  if (!event) return NextResponse.json({ error: 'Grand Night event not found', eventNames: events.map(e => e.name).slice(0, 10) });

  // ── Availability API ──────────────────────────────────────────────────────
  const availUrl = `${base}/events/${event.id}/availability?start_from=2026-06-01&start_to=2026-06-30`;
  const availRes = await fetch(availUrl, { headers: sign(availUrl) });
  const availRaw = await availRes.json();
  const availData = Array.isArray(availRaw) ? availRaw : (Array.isArray(availRaw?.data) ? availRaw.data : []);

  const availSample = availData.slice(0, 3).map(inst => ({
    // Show ALL top-level keys so we can see what's available
    allKeys: Object.keys(inst),
    id: inst.id,
    instanceId: inst.instanceId,
    start: inst.start,
    capacity: inst.capacity,
    availabilityStatuses: (inst.availability || []).map(a => ({ status: a.status, count: a.count })),
  }));

  // ── Orders API ────────────────────────────────────────────────────────────
  const ordUrl = `${base}/orders?DateFrom=2026-06-01&DateTo=2026-06-08&page=1&pageSize=10`;
  const ordRes = await fetch(ordUrl, { headers: sign(ordUrl) });
  const ordRaw = await ordRes.json();
  const orders = Array.isArray(ordRaw) ? ordRaw : [];

  // Find first ticket belonging to this event
  let sampleTicket = null;
  for (const order of orders) {
    for (const t of order.tickets || []) {
      if (t.event?.id === event.id) {
        sampleTicket = {
          ticketAllKeys: Object.keys(t),
          eventId: t.event?.id,
          instanceAllKeys: t.instance ? Object.keys(t.instance) : null,
          instanceId: t.instance?.id,
          instanceStart: t.instance?.start,
          instanceStartDateTime: t.instance?.startDateTime,
          instanceDateTime: t.instance?.dateTime,
          rawInstance: t.instance,
        };
        break;
      }
    }
    if (sampleTicket) break;
  }

  // ── ID match check ────────────────────────────────────────────────────────
  const availIds = availData.map(i => i.id).filter(Boolean);
  const orderInstanceIds = orders
    .flatMap(o => o.tickets || [])
    .filter(t => t.event?.id === event.id)
    .map(t => t.instance?.id)
    .filter(Boolean);

  const matchCount = orderInstanceIds.filter(id => availIds.includes(id)).length;

  return NextResponse.json({
    eventId: event.id,
    eventName: event.name,
    availInstanceCount: availData.length,
    availSample,
    sampleTicket,
    idMatchCheck: {
      availIds: availIds.slice(0, 5),
      orderInstanceIds: [...new Set(orderInstanceIds)].slice(0, 5),
      matchCount,
      totalOrderTicketsChecked: orderInstanceIds.length,
    },
  });
}
