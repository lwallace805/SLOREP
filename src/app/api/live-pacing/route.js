import { NextResponse } from 'next/server';
import { getEvents, getInstanceAvailability } from '@/lib/spektrix';

// Fresh on every request — this is the "live" endpoint
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const events = await getEvents();

    // For each event compute: current d (days from first instance) and total sold
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      events
        .filter((e) => e.name && e.firstInstanceDateTime)
        .map(async (e) => {
          try {
            const instances = await getInstanceAvailability(e.id);
            const totalSold = instances.reduce((s, i) => s + i.sold, 0);

            const openDate = new Date(e.firstInstanceDateTime);
            openDate.setHours(0, 0, 0, 0);
            const d = Math.round((today - openDate) / 86400000);

            return { name: e.name, d, c: totalSold };
          } catch {
            return null;
          }
        })
    );

    const live = {};
    for (const r of results) {
      if (r) live[r.name] = { d: r.d, c: r.c };
    }

    return NextResponse.json(live);
  } catch (err) {
    console.error('live-pacing error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
