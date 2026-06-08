import { NextResponse } from 'next/server';
import { getEvents, getInstanceAvailability } from '@/lib/spektrix';

// Never cache — revalidate=300 caused Vercel to cache the full HTTP response
// at the CDN level, meaning new code never ran until the 5-min TTL expired.
export const dynamic = 'force-dynamic';

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

    return NextResponse.json({ name: event.name, eventId: event.id, instances });
  } catch (err) {
    console.error('Spektrix /instances error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
