import { NextResponse } from 'next/server';
import { getEvents, getEventsAround, findEvent, getInstanceAvailability, getPastInstances } from '@/lib/spektrix';

// Never cache at the CDN level; freshness is managed by the client-side
// 5-minute refresh interval in PacingDashboard.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const eventName = searchParams.get('name');

  if (!eventName) {
    return NextResponse.json({ error: 'name param required' }, { status: 400 });
  }

  try {
    // ?open=YYYY-MM-DD finds a closed show, which the bare listing no longer carries.
    const events = await getEvents();
    const lookup = {};
    const event = findEvent(events, eventName)
      || findEvent(await getEventsAround(searchParams.get('open'), lookup), eventName);
    if (!event) {
      if (searchParams.get('debug')) {
        return NextResponse.json({ error: `Event not found: ${eventName}`, eventsSeen: events.length, lookup }, { status: 404 });
      }
      return NextResponse.json({ error: `Event not found: ${eventName}` }, { status: 404 });
    }

    const instances = await getInstanceAvailability(event.id);
    // Availability is empty for a run long past; list the performances the
    // other way so a closed show's capacity can still be established.
    const past = instances.length ? null : await getPastInstances(event.id);

    return NextResponse.json({ name: event.name, eventId: event.id, instances, ...(past ? { past } : {}) });
  } catch (err) {
    console.error('Spektrix /instances error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
