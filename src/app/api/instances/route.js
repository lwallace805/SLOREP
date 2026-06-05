import { NextResponse } from 'next/server';
import { getEvents, getInstanceAvailability, spektrixGetAll } from '@/lib/spektrix';
import { getPerInstanceCounts } from '@/lib/livePacing';

// Dynamic because it reads query params, but responses are meaningful to cache
export const dynamic = 'force-dynamic';

const ORDERS_TIMEOUT_MS = 12000; // fall back to availability API after 12s

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const eventName = searchParams.get('name');
  const saleStart = searchParams.get('saleStart') || '2024-06-01';

  if (!eventName) {
    return NextResponse.json({ error: 'name param required' }, { status: 400 });
  }

  try {
    const events = await getEvents();
    const event = events.find(
      (e) => e.name?.toLowerCase() === eventName.toLowerCase()
    );
    if (!event) {
      return NextResponse.json({ error: `Event not found: ${eventName}` }, { status: 404 });
    }

    // Try orders-based count (accurate: includes comps + subscriptions).
    // Race against a timeout — if orders are too slow, fall back to availability API.
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve(null), ORDERS_TIMEOUT_MS)
    );

    const ordersResult = await Promise.race([
      getPerInstanceCounts(event.id, saleStart),
      timeout,
    ]);

    if (ordersResult) {
      // Orders succeeded — build accurate per-instance rows
      const rawInsts = await spektrixGetAll(`/events/${event.id}/instances`);
      const instances = rawInsts
        .map((inst) => {
          const dt = inst.start ? inst.start.slice(0, 16).replace('T', ' ') : null;
          if (!dt) return null;
          const sold = ordersResult[inst.id] || 0;
          const cap = 108; // SLO Rep standard instance capacity
          return { dt, sold, cap, pct: Math.round((sold / cap) * 1000) / 10 };
        })
        .filter(Boolean)
        .sort((a, b) => a.dt.localeCompare(b.dt));

      return NextResponse.json({ name: event.name, eventId: event.id, instances, source: 'orders' });
    }

    // Fallback: availability API (fast, but misses ~117 subscription/comp seats)
    console.warn(`instances: orders timed out for ${eventName}, falling back to availability API`);
    const instances = await getInstanceAvailability(event.id);
    return NextResponse.json({ name: event.name, eventId: event.id, instances, source: 'availability' });

  } catch (err) {
    console.error('instances route error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
