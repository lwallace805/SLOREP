import { NextResponse } from 'next/server';
import { getEvents, getEventsAround, findEvent, getInstanceAvailability } from '@/lib/spektrix';

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
    let around = null;
    const event = findEvent(events, eventName)
      || findEvent(around = await getEventsAround(searchParams.get('open')), eventName);
    if (!event) {
      if (searchParams.get('debug')) {
        return NextResponse.json({ error: `Event not found: ${eventName}`, eventsSeen: events.length,
          aroundSeen: around?.length ?? null, aroundNames: (around || []).map(e => e.name).slice(0, 40) }, { status: 404 });
      }
      return NextResponse.json({ error: `Event not found: ${eventName}` }, { status: 404 });
    }

    const instances = await getInstanceAvailability(event.id);

    return NextResponse.json({ name: event.name, eventId: event.id, instances });
  } catch (err) {
    console.error('Spektrix /instances error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
