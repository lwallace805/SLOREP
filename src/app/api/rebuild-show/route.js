/**
 * /api/rebuild-show?name=<showName>[&comps=0|1]
 *
 * One show's entry for src/data/pacingData.js, built from the order scan on
 * one stated basis: the show's first baked point to its closing night (or
 * today while it is still on sale), all seats unless comps=0, capacity from
 * Spektrix's performance count and seating plan, `p` as percent of final.
 *
 * The scan is walked in 120-day legs, each cached under the same key
 * history-fill uses, so a call that runs out of time can be repeated and
 * picks up where it left off: it answers `partial: true` with the legs it
 * finished when the next leg would not fit in the budget. This exists for
 * scripts/rebuild-pacing-data.mjs and for rebuilding from a client that
 * cannot wait a minute per show.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getEvents, getEventsAround, findEvent, getInstanceAvailability, getPastInstances } from '@/lib/spektrix';
import { scanOrders, buildSeries, scanWindow, addDays, daysBetween } from '@/lib/historyFill';
import { DATA } from '@/data/pacingData';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A subscription on-sale week is a heavy window: the June 2023 windows timed
// out at 20s a page on every 23-24 show. Two-day windows halve what Spektrix
// has to filter per request, and the request gets longer to answer. The
// function may outlive a client's 60s wait; a complete leg is cached, so the
// next call picks it up.
const REQUEST_TIMEOUT_MS = 40000;
const LEG_BUDGET_MS = 55000;
const WINDOW_DAYS = 2;
// Do not start a leg past this point in the call; answer partial instead.
const CALL_BUDGET_MS = 50000;
const SCAN_TTL_SECONDS = 900;

function spektrixSign(url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`GET\n${url}\n${date}`)
    .digest('base64');
  return { Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`, Date: date };
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: spektrixSign(url), signal: controller.signal });
    if (!res.ok) return { error: `http ${res.status}` };
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return { error: `content-type ${type || 'none'}` };
    const body = await res.json();
    if (!Array.isArray(body)) return { error: 'body not an array' };
    return { orders: body };
  } catch (err) {
    return { error: err?.name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : `fetch: ${err?.message || 'unknown'}` };
  } finally {
    clearTimeout(timer);
  }
}

// An incomplete leg is not cached: throwing out of the cached function stores
// nothing, so the next call retries the window that timed out instead of
// serving the hole for a quarter of an hour. The partial still comes back
// for this call, carried on the error.
class IncompleteLeg extends Error { constructor(leg) { super('incomplete leg'); this.leg = leg; } }
const cachedLeg = async (eventId, scanFrom, scanTo, includeComps) => {
  try {
    return await unstable_cache(
      async () => {
        const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
        const scan = await scanOrders({ eventId, scanFrom, scanTo, base, fetchPage, includeComps, windowDays: WINDOW_DAYS, deadline: Date.now() + LEG_BUDGET_MS });
        // Only the parts the series needs; the cache entry stays small.
        const leg = { byDay: scan.byDay, complete: scan.complete, incompleteWindows: scan.incompleteWindows, compTickets: scan.compTickets };
        if (!scan.complete) throw new IncompleteLeg(leg);
        return leg;
      },
      ['rebuild-show', 'v1', eventId, scanFrom, scanTo, includeComps ? 'comps' : 'paid'],
      { revalidate: SCAN_TTL_SECONDS, tags: ['history-fill'] },
    )();
  } catch (err) {
    if (err instanceof IncompleteLeg) return err.leg;
    throw err;
  }
};

export async function GET(request) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  const includeComps = searchParams.get('comps') !== '0';
  const show = DATA.find(s => s.name === name);
  if (!show) return NextResponse.json({ error: 'not in pacingData', name }, { status: 404 });
  if (!show.series?.length) return NextResponse.json({ error: 'no series', name }, { status: 400 });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const events = await getEvents();
    const event = findEvent(events, show.name) || findEvent(await getEventsAround(show.open), show.name);
    if (!event) return NextResponse.json({ error: 'Event not found', name }, { status: 404 });

    // Run window and capacity.
    let cap = show.cap, close = null, capSource = 'file';
    const avail = await getInstanceAvailability(event.id);
    if (avail.length) {
      cap = avail.reduce((s, i) => s + (i.cap || 0), 0);
      close = avail[avail.length - 1].dt.slice(0, 10);
      capSource = 'availability';
    } else {
      const past = await getPastInstances(event.id);
      const live = (past.instances || []).filter(i => !i.cancelled);
      if (live.length) {
        const seats = (past.plan?.areas || []).reduce((s, a) => s + (a.capacity ?? a.seats ?? 0), 0);
        if (seats) { cap = live.length * seats; capSource = 'plan'; }
        close = live[live.length - 1].dt.slice(0, 10);
      }
    }
    const last = show.series[show.series.length - 1];
    if (!close && last.d > 0) close = addDays(show.open, last.d);
    const closed = close != null && close < today;
    const to = closed ? close : today;
    const from = addDays(show.open, show.series[0].d);

    // Legs.
    const series = [];
    let baseline = 0, cur = from, complete = true, partial = false, legs = 0, comps = 0;
    const problems = [];
    while (cur <= to) {
      if (Date.now() - started > CALL_BUDGET_MS) { partial = true; break; }
      const { scanFrom, scanTo, truncated } = scanWindow(cur, to);
      const leg = await cachedLeg(event.id, scanFrom, scanTo, includeComps);
      const built = buildSeries({ byDay: leg.byDay, baselineCount: baseline, openDate: show.open, scanFrom, scanTo, today: to, truncated });
      const lastD = series.length ? series[series.length - 1].d : -Infinity;
      for (const pt of built.series) if (pt.d > lastD) series.push(pt);
      baseline = built.total;
      complete = complete && leg.complete;
      comps += leg.compTickets ?? 0;
      for (const w of leg.incompleteWindows || []) problems.push(w);
      legs++;
      if (!truncated || scanTo >= to) break;
      cur = addDays(scanTo, 1);
    }

    // Keep the first point and every day the total moved; drop flat stamps.
    const pts = series.filter((p, i) => i === 0 || p.c !== series[i - 1].c);
    const total = series.length ? series[series.length - 1].c : 0;
    const final = closed && !partial ? total : null;
    const denom = total || 1;
    const out = pts.map(p => ({ d: p.d, c: p.c, p: Math.round(p.c / denom * 1000) / 10 }));

    return NextResponse.json({
      name: show.name, eventId: event.id, cat: show.cat, season: show.season, open: show.open,
      cap, capSource, close, closed, from, to, legs, partial, complete, problems, compTickets: comps,
      total, final, oldFinal: show.final, oldCap: show.cap,
      points: out.length,
      // Compact: "d:c" per point; p is c over the final and is recomputed by the writer.
      series: out.map(p => `${p.d}:${p.c}`).join(','),
      ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, name }, { status: 500 });
  }
}
