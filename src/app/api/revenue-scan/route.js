/**
 * /api/revenue-scan?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>[&win=2][&conc=6][&debug=1]
 * /api/revenue-scan?meta=1&events=<id,id,...>
 *
 * Ticket dollars, not only ticket counts. Every other route here counts
 * seats; this one sums what each seat was sold for, per show, split by ticket
 * type and by whether the order carries a subscription, so paid media (or any
 * other cost) can be read against single-ticket revenue, subscriber revenue
 * and comps separately.
 *
 * One call covers a date range of orders, bucketed by the day the order was
 * first placed (firstTransactionDate, the theatre's local day), for every
 * event at once. Walk a season by calling consecutive, non-overlapping
 * ranges and adding the answers up; an order is only ever counted in the
 * range that holds its first transaction, so the ranges never double count.
 *
 * How it stays honest:
 *  - The range is queried one day wider at each end. Spektrix filters orders
 *    by transaction time and an evening order can sit on the next day's side
 *    of that filter; the pad catches it, and the local-day check then places
 *    it in exactly one range.
 *  - Orders are de-duplicated by id across windows. An order paid in parts
 *    touches several windows and would otherwise be summed once per window.
 *  - A window is finished only when it returns a short page. One that fails,
 *    runs out of time, or keeps repeating a page is named in the answer and
 *    `complete` is false; finished windows are cached, so calling again only
 *    re-fetches what was missing.
 *  - It reads the order's tickets as they stand now, so the figures are net of
 *    returns and exchanges.
 *
 * The answer carries aggregates only: event id, ticket type id, offer id,
 * subscription product name, counts and sums. No order ids and no customer
 * fields leave the function.
 *
 * meta=1 resolves ids to names: each event's name and run dates (closed shows
 * included, which the bare events listing no longer carries) and the ticket
 * type names.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import crypto from 'crypto';
import { spektrixGet } from '@/lib/spektrix';
import { dateWindows, addDays, daysBetween } from '@/lib/historyFill';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const REQUEST_TIMEOUT_MS = 40000;
// Past this point in the call no new page is started; the answer goes back
// partial rather than the platform killing the function with nothing.
const CALL_BUDGET_MS = 95000;
const MAX_RANGE_DAYS = 45;
const MAX_PAGES_PER_WINDOW = 40;
const PAGE_SIZE = 200;
// Orders already placed barely move (a return or an exchange changes them),
// so a finished window is worth keeping for a working session.
const WINDOW_TTL_SECONDS = 6 * 3600;
// The ids the other routes carry for these are not the ids Spektrix returns
// (its /ticket-types listing is the source for the ones below), so a comp is
// recognised here by its face price being zero, with the named comp types as
// a second check for a comp issued against a priced seat.
const COMP_NAMED = new Set([
  '601APNNMRMBJQQPBSCNQGQHGKKCRPSSGN', // Artist Comp
  '801ARDQDDMGGJKKRTNTJBMCCMMBCPQKCR', // Sponsor Comps
  '1001ADGKSHLJDTDBJQTBMGLLJRLBJCMNN', // Volunteer Comp
  '1002AHCBPDSTCNNKTDJHQGSBVHKNHQLMG', // General Comp
]);
const GROUP_TYPE_IDS = new Set(['2201AVBSMNJRLVSBVJRSDNQHLHDGPHDLD']);

function sign(url) {
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
    const res = await fetch(url, { headers: sign(url), signal: controller.signal });
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

const idOf = (v) => (typeof v === 'string' ? v : (v?.id || ''));
const day = (v) => (typeof v === 'string' ? v.slice(0, 10) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const cents = (v) => Math.round(num(v) * 100);

/**
 * One order, reduced to what the sums need. Tickets are grouped inside the
 * order by event, ticket type, whether the face price is zero (a comp), how
 * the price paid sits against the face price, and the offer applied. Money is
 * held in cents so the sums stay exact.
 *
 * Price flag: z = nothing charged on the ticket, d = charged below face,
 * f = charged at face, e = charged at face as part of a season ticket.
 *
 * A season ticket shows on an order twice: as a subscription line with a
 * price, and as the seats it covers. On the orders checked the line's price
 * is the sum of its seats' prices, the same money stated twice, so the seats
 * already carry it and nothing is added. The order is tested rather than
 * trusted, and `mode` records which case it was:
 *   tickets   line price equals the below-face seats: the seats carry it.
 *   face      line price equals below-face plus at-face seats: the season
 *             ticket is priced at face, and those seats are flagged e.
 *   line      the line holds money the seats do not. The difference is
 *             spread over the order's zero-charged seats in proportion to
 *             face price (`alloc`), so each show gets its share.
 *   unplaced  as line, but the order has no zero-charged seat to take it.
 *   under     the line is less than the below-face seats (a discount from an
 *             offer sitting beside the season ticket).
 * A zero-charged seat that receives no allocation was given away, whatever
 * its ticket type says: a comp season ticket is exactly that.
 *
 *   [id, localDay, utcDay, lastDay, subscriptionCount,
 *    { "event|type|faceZero|priceFlag|offer": [n, original, price, discount, total, alloc] },
 *    { "structure|pricingSet": [n, price] },
 *    mode, gapCents]
 */
function compactOrder(o) {
  const subLines = o?.ticketSubscriptions || [];
  const subCents = subLines.reduce((n, s) => n + cents(s?.price), 0);
  const rows = [];
  let below = 0, atFace = 0;
  for (const t of o?.tickets || []) {
    const eventId = idOf(t?.event);
    if (!eventId) continue;
    const typeId = idOf(t?.type) || idOf(t?.ticketType);
    const orig = cents(t?.originalPrice), price = cents(t?.price);
    const flag = price === 0 ? 'z' : (price < orig ? 'd' : 'f');
    if (flag === 'd') below += price;
    if (flag === 'f') atFace += price;
    rows.push({ eventId, typeId, orig, price, flag, discount: cents(t?.discount), total: cents(t?.total), offer: idOf(t?.offer) });
  }
  let mode = '', gap = 0;
  if (subLines.length) {
    gap = subCents - below;
    const takers = rows.filter(r => r.flag === 'z' && r.orig > 0 && !COMP_NAMED.has(r.typeId));
    if (gap === 0) mode = 'tickets';
    else if (gap < 0) mode = 'under';
    else if (atFace > 0 && gap === atFace) mode = 'face';
    else if (takers.length) mode = 'line';
    else mode = 'unplaced';
    if (mode === 'face') for (const r of rows) if (r.flag === 'f') r.flag = 'e';
    if (mode === 'line') {
      const face = takers.reduce((n, r) => n + r.orig, 0);
      let placed = 0;
      takers.forEach((r, i) => {
        r.alloc = i === takers.length - 1 ? gap - placed : Math.floor(gap * r.orig / face);
        placed += r.alloc;
      });
    }
  }
  const tix = {};
  for (const r of rows) {
    const key = `${r.eventId}|${r.typeId}|${r.orig === 0 ? 1 : 0}|${r.flag}|${r.offer}`;
    const a = tix[key] || (tix[key] = [0, 0, 0, 0, 0, 0]);
    a[0] += 1;
    a[1] += r.orig;
    a[2] += r.price;
    a[3] += r.discount;
    a[4] += r.total;
    a[5] += r.alloc || 0;
  }
  const subs = {};
  for (const s of subLines) {
    const key = `${s?.ticketSubscriptionStructureName || 'unnamed'}|${s?.pricingSetName || ''}`;
    const a = subs[key] || (subs[key] = [0, 0]);
    a[0] += 1;
    a[1] += cents(s?.price);
  }
  return [
    o?.id || '',
    day(o?.firstTransactionDate) || day(o?.firstTransactionDateUtc),
    day(o?.firstTransactionDateUtc),
    day(o?.lastTransactionDate),
    subLines.length,
    tix,
    subs,
    mode,
    gap,
  ];
}

// Key names only, never values: enough to see how a nested object is shaped
// without a customer field or an order id leaving the function.
function keysOf(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return typeof v;
  return Object.keys(v).slice(0, 40);
}

/** Page one window to its end. Returns { from, to, status, pages, orders, shape }. */
async function scanOneWindow(base, from, to, deadline) {
  const out = { from, to, status: 'open', pages: 0, fetched: 0, orders: [], shape: null };
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page++) {
    if (Date.now() > deadline) { out.status = 'deadline'; return out; }
    const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=${page}&pageSize=${PAGE_SIZE}`;
    const r = await fetchPage(url);
    if (r.error) { out.status = `error: p${page} ${r.error}`; return out; }
    out.pages = page;
    out.fetched += r.orders.length;
    let fresh = 0;
    for (const o of r.orders) {
      const id = o?.id;
      if (id) { if (seen.has(id)) continue; seen.add(id); }
      fresh++;
      out.orders.push(compactOrder(o));
      const sh = out.shape || (out.shape = {});
      for (const t of o?.tickets || []) {
        if (!sh.type && t?.type != null) sh.type = keysOf(t.type);
        if (!sh.ticketType && t?.ticketType != null) sh.ticketType = keysOf(t.ticketType);
        if (!sh.offer && t?.offer != null) sh.offer = keysOf(t.offer);
      }
      const sub = (o?.ticketSubscriptions || [])[0];
      if (!sh.ticketSubscription && sub != null) {
        sh.ticketSubscription = keysOf(sub);
        sh.ticketSubscriptionNested = typeof sub === 'object'
          ? Object.fromEntries(Object.entries(sub).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k, Array.isArray(v) ? { array: v.length, item: keysOf(v[0]) } : keysOf(v)]))
          : null;
      }
    }
    if (r.orders.length < PAGE_SIZE) { out.status = 'done'; return out; }
    // Spektrix answers some windows with the same orders on every page. A full
    // page that adds nothing new is the end of what the window will give; it
    // is reported as `repeated` so the caller can re-run it in one-day windows
    // and see whether anything was hidden behind the repetition.
    if (fresh === 0) { out.status = 'repeated'; return out; }
  }
  out.status = 'ceiling';
  return out;
}

class Incomplete extends Error { constructor(win) { super('incomplete window'); this.win = win; } }

async function cachedWindow(base, from, to, deadline) {
  try {
    return await unstable_cache(
      async () => {
        const win = await scanOneWindow(base, from, to, deadline);
        // Only a window that reached its short page is stored. Throwing out of
        // the cached function stores nothing, so the next call retries it.
        if (win.status !== 'done') throw new Incomplete(win);
        return win;
      },
      ['revenue-scan', 'v4', from, to],
      { revalidate: WINDOW_TTL_SECONDS, tags: ['revenue-scan'] },
    )();
  } catch (err) {
    if (err instanceof Incomplete) return err.win;
    return { from, to, status: `error: ${err?.message || 'unknown'}`, pages: 0, fetched: 0, orders: [], shape: null };
  }
}

/** Run tasks with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

async function meta(searchParams) {
  const ids = (searchParams.get('events') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 80);
  const events = await pool(ids, 6, async (id) => {
    try {
      const e = await spektrixGet(`/events/${id}`);
      let perfs = null;
      try {
        const raw = await spektrixGet(`/events/${id}/instances`);
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const live = list.filter(i => !i?.cancelled);
        const starts = live.map(i => (i?.start || '').slice(0, 16)).filter(Boolean).sort();
        perfs = { count: live.length, cancelled: list.length - live.length, first: starts[0] || null, last: starts[starts.length - 1] || null };
      } catch (err) { perfs = { error: err.message }; }
      return { id, name: e?.name ?? null, first: e?.firstInstanceDateTime ?? null, last: e?.lastInstanceDateTime ?? null, perfs };
    } catch (err) {
      return { id, error: err.message };
    }
  });
  let ticketTypes = null;
  try {
    const raw = await spektrixGet('/ticket-types');
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    ticketTypes = list.map(t => ({ id: t?.id, name: t?.name }));
  } catch (err) { ticketTypes = { error: err.message }; }
  // Ids the current listing no longer names (a retired ticket type, an offer),
  // tried one at a time against each path given.
  const lookups = {};
  for (const [param, path] of [['types', 'ticket-types'], ['offers', 'offers'], ['subs', 'ticket-subscriptions']]) {
    const want = (searchParams.get(param) || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 80);
    if (!want.length) continue;
    lookups[param] = await pool(want, 6, async (id) => {
      try { const r = await spektrixGet(`/${path}/${id}`); return { id, name: r?.name ?? null, keys: keysOf(r) }; }
      catch (err) { return { id, error: err.message }; }
    });
  }
  return NextResponse.json({
    events, ticketTypes, lookups,
    compTypeIds: [...COMP_NAMED], groupTypeIds: [...GROUP_TYPE_IDS],
  });
}

export async function GET(request) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get('meta')) return await meta(searchParams);

    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(from || '') || !iso.test(to || '') || to < from) {
      return NextResponse.json({ error: 'from and to required as YYYY-MM-DD, from <= to' }, { status: 400 });
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `range limited to ${MAX_RANGE_DAYS} days per call` }, { status: 400 });
    }
    const win = Math.min(4, Math.max(1, parseInt(searchParams.get('win') || '2', 10) || 2));
    const conc = Math.min(12, Math.max(1, parseInt(searchParams.get('conc') || '6', 10) || 6));
    const debug = !!searchParams.get('debug');

    const today = new Date().toISOString().slice(0, 10);
    const qFrom = addDays(from, -1);
    const padTo = addDays(to, 1);
    const qTo = padTo > addDays(today, 1) ? addDays(today, 1) : padTo;
    const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
    const deadline = started + CALL_BUDGET_MS;
    const windows = dateWindows(qFrom, qTo, win);
    const scans = await pool(windows, conc, w => cachedWindow(base, w.from, w.to, deadline));

    // De-duplicate across windows, keep the orders first placed inside the
    // asked range, and sum.
    const seen = new Set();
    const agg = {};
    const subAgg = {};
    const modes = {};
    let orders = 0, tickets = 0, before = 0, after = 0, utcDayDiffers = 0, undated = 0, subOrders = 0;
    let shape = null;
    const report = [];
    for (const s of scans) {
      let lateLocal = 0, lateUtc = 0;
      for (const [id, local, utc, , subs, tix, subLines, mode, gap] of s.orders) {
        if (local > s.to) lateLocal++;
        if (utc > s.to) lateUtc++;
        if (id) { if (seen.has(id)) continue; seen.add(id); }
        if (!local) { undated++; continue; }
        if (local < from) { before++; continue; }
        if (local > to) { after++; continue; }
        orders++;
        if (utc && utc !== local) utcDayDiffers++;
        if (subs > 0) subOrders++;
        for (const [key, a] of Object.entries(tix)) {
          const [eventId, typeId, o0, flag, offerId] = key.split('|');
          const ev = agg[eventId] || (agg[eventId] = {});
          const k = `${typeId}|${subs > 0 ? 1 : 0}|${o0}|${flag}|${offerId || ''}`;
          const b = ev[k] || (ev[k] = [0, 0, 0, 0, 0, 0]);
          for (let i = 0; i < 6; i++) b[i] += a[i];
          tickets += a[0];
        }
        for (const [key, a] of Object.entries(subLines || {})) {
          const b = subAgg[key] || (subAgg[key] = [0, 0]);
          for (let i = 0; i < 2; i++) b[i] += a[i];
        }
        if (mode) {
          const m = modes[mode] || (modes[mode] = [0, 0]);
          m[0] += 1;
          m[1] += gap || 0;
        }
      }
      if (s.shape) shape = { ...s.shape, ...(shape || {}) };
      report.push({ from: s.from, to: s.to, status: s.status, pages: s.pages, fetched: s.fetched, kept: s.orders.length, ...(debug ? { lateLocal, lateUtc } : {}) });
    }
    const incomplete = report.filter(w => w.status !== 'done').map(w => `${w.from}..${w.to}: ${w.status}`);

    return NextResponse.json({
      from, to, queried: `${qFrom}..${qTo}`, win,
      complete: incomplete.length === 0,
      incomplete,
      orders, tickets, subOrders,
      // Orders seen but first placed outside the asked range (they belong to a
      // neighbouring call), and orders whose UTC day differs from the local
      // day they were bucketed on.
      outside: { before, after, undated, utcDayDiffers },
      // agg[eventId]["typeId|sub|faceZero|priceFlag|offerId"] = [tickets, original, price, discount, total, alloc], money in cents.
      // sub = the order also carries a season-ticket purchase. priceFlag z/d/f/e = charged nothing / below face / at face / at face inside a season ticket.
      // alloc = season-ticket money the seats did not already carry, spread onto that order's zero-charged seats.
      agg,
      // Season-ticket purchases, "structure|pricingSet" = [lines, price], money in cents.
      subscriptions: subAgg,
      // How each season-ticket order's line price sat against its seats:
      // mode = [orders, line price minus below-face seat prices, in cents].
      subscriptionModes: modes,
      ...(debug ? { windows: report, shape } : {}),
      ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
