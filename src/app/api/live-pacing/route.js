import { NextResponse } from 'next/server';
import { getLivePacingData } from '@/lib/livePacing';

export const dynamic = 'force-dynamic';

// Thin wrapper — the logic lives in src/lib/livePacing.js
// so it can also be called directly from the server page (no HTTP round-trip).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const showName = searchParams.get('name');

  if (!showName) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  try {
    // Build a minimal "show" descriptor matching what getLivePacingData expects.
    // baselineDate, baselineCount and openDate come from the client query string.
    const baselineDate  = searchParams.get('baselineDate');
    const baselineCount = parseInt(searchParams.get('baselineCount') || '0', 10);
    const openDate      = searchParams.get('openDate');

    if (!baselineDate || !openDate) {
      return NextResponse.json({ error: 'baselineDate and openDate required' }, { status: 400 });
    }

    // Reconstruct the minimal series endpoint getLivePacingData needs
    const [oy, om, od] = openDate.split('-').map(Number);
    const [by, bm, bd] = baselineDate.split('-').map(Number);
    const openUtcMs     = Date.UTC(oy, om - 1, od);
    const baselineUtcMs = Date.UTC(by, bm - 1, bd);
    const lastD = Math.round((baselineUtcMs - openUtcMs) / 86400000);

    const fakeShow = {
      name: showName,
      open: openDate,
      inProgress: true,
      series: [{ d: lastD, c: baselineCount, p: 0 }],
    };

    const result = await getLivePacingData([fakeShow]);
    const data = result[showName];

    if (!data) {
      return NextResponse.json({ error: 'Event not found or no data' }, { status: 404 });
    }

    return NextResponse.json({ ...data, baselineCount });
  } catch (err) {
    console.error('live-pacing API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
