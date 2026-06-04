import { NextResponse } from 'next/server';
import { getEvents, getInstanceAvailability } from '@/lib/spektrix';

// Cache for 1 hour — instance data changes more frequently
export const revalidate = 3600;

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

    const instances = await getInstanceAvailability(event.id);

    return NextResponse.json({
      name: event.name,
      eventId: event.id,
      instances,
    });
  } catch (err) {
    console.error('Spektrix /instances error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
