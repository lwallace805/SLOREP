import { NextResponse } from 'next/server';
import { getEvents, getInstanceAvailability } from '@/lib/spektrix';
import { getPerInstanceCounts } from '@/lib/livePacing';

// 5-minute cache — same cadence as pacing page.
// The orders-based per-instance fetch adds ~3-5s of compute, but ISR means
// subsequent requests within the window are served instantly from cache.
export const revalidate = 300;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const eventName = searchParams.get('name');

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

    // Step 1: get instance list (dates, times, capacity, IDs) from availability API.
    // The 'sold' figures here are UNRELIABLE for past performances — Spektrix resets
    // seat statuses after a performance date passes. We override them below.
    const instances = await getInstanceAvailability(event.id);
    if (!instances.length) {
      return NextResponse.json({ name: event.name, eventId: event.id, instances: [] });
    }

    // Step 2: get accurate per-instance ticket counts from the orders API.
    // Query from 9 months before the earliest instance to cover the full pre-sale
    // window (typical SLO Rep pre-sale opens 4-6 months out; 9 months is safe buffer).
    const earliest = instances[0].dt.slice(0, 10); // sorted asc
    const [ey, em, ed] = earliest.split('-').map(Number);
    const saleStartMs = Date.UTC(ey, em - 1, ed) - 270 * 86400000; // ~9 months back
    const saleStartDate = new Date(saleStartMs).toISOString().slice(0, 10);

    const instanceCounts = await getPerInstanceCounts(event.id, saleStartDate);

    // Step 3: merge — use orders-based count when we have an instance ID match,
    // fall back to availability API count (upcoming shows where orders haven't
    // settled yet, or instances missing an ID for some reason).
    const merged = instances.map((inst) => {
      const orderCount = inst.id != null ? (instanceCounts[inst.id] ?? null) : null;
      const sold = orderCount !== null ? orderCount : inst.sold;
      const pct = inst.cap > 0 ? Math.round((sold / inst.cap) * 1000) / 10 : 0;
      return { ...inst, sold, pct };
    });

    return NextResponse.json({ name: event.name, eventId: event.id, instances: merged });
  } catch (err) {
    console.error('Spektrix /instances error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
