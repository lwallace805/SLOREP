import { NextResponse } from 'next/server';
import { getEvents, getInstanceAvailability } from '@/lib/spektrix';

// Cache for 12 hours
export const revalidate = 43200;

export async function GET() {
  try {
    const events = await getEvents();

    // Filter to shows with actual performances (not subscriptions etc.)
    // and compute total sold + run date range for each
    const shows = await Promise.all(
      events
        .filter((e) => e.name && e.firstInstanceDateTime)
        .map(async (e) => {
          const instances = await getInstanceAvailability(e.id);
          const totalSold = instances.reduce((s, i) => s + i.sold, 0);
          const totalCap = instances.reduce((s, i) => s + i.cap, 0);
          return {
            id: e.id,
            name: e.name,
            firstInstance: e.firstInstanceDateTime,
            lastInstance: e.lastInstanceDateTime,
            instanceCount: instances.length,
            totalSold,
            totalCap,
            pct: totalCap > 0 ? Math.round((totalSold / totalCap) * 1000) / 10 : 0,
          };
        })
    );

    // Sort by first instance date desc (most recent first)
    shows.sort((a, b) => b.firstInstance.localeCompare(a.firstInstance));

    return NextResponse.json(shows);
  } catch (err) {
    console.error('Spektrix /shows error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
