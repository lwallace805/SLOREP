import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/spektrix';

// Cache for 12 hours — just a name/date list, no heavy availability calls
export const revalidate = 43200;

export async function GET() {
  try {
    const events = await getEvents();

    const shows = events
      .filter((e) => e.name && e.firstInstanceDateTime)
      .map((e) => ({
        id: e.id,
        name: e.name,
        firstInstance: e.firstInstanceDateTime,
        lastInstance: e.lastInstanceDateTime,
      }))
      .sort((a, b) => b.firstInstance.localeCompare(a.firstInstance));

    return NextResponse.json(shows);
  } catch (err) {
    console.error('Spektrix /shows error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
