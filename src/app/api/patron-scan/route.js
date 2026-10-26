/**
 * /api/patron-scan?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>[&events=0][&cohorts=0][&min=50][&conc=8][&debug=1]
 *
 * Who bought, not only what sold. The other scans here reduce an order to
 * its seats; this one also keeps which customer placed it, so a season can be
 * read as patrons: how many people a show brought in for the first time,
 * whether those people came back, and how a promo code's buyers behaved
 * afterwards. The customer id never leaves the function. It is used to group
 * orders and then dropped; the answer carries counts, sums and event ids.
 *
 * Everything is measured inside [from, to]. A customer is "new" when their
 * first order in that range is the one being looked at, so `from` is the
 * lookback: a cohort is only as trustworthy as the months before it. With
 * `from` in May 2024, a first order in May 2025 or later has at least a year
 * of history behind it, and one in May 2026 two years.
 *
 * Windows are fetched two days at a time and cached for a day once they page
 * to their end, the same way /api/revenue-scan works. A range too long to
 * fetch inside one call comes back `complete: false` naming the windows it
 * did not finish; call it again (or call shorter ranges first) and it picks
 * up from the cache. Reading a cached range of two years takes seconds.
 *
 * events:  per event id, with its name and run dates resolved:
 *   t tickets, comp, paid, sub (seats on an order that also bought a season
 *   ticket), single (paid, not sub), adu/sen/stu/grp by ticket type name,
 *   rev (dollars charged for paid seats, fees included), disc (dollars of
 *   discount applied), orders, cust (distinct customers), anon (tickets on
 *   orders with no customer), nc (customers whose first order in the range
 *   was for this show), nct (their tickets), ncRet (of those, how many later
 *   bought a different show inside the range), timing buckets by days from
 *   order to opening night (pre60, d30_59, d8_29, d0_7, run, post), and
 *   offers: offerId -> [tickets, discount dollars, revenue dollars, new
 *   customers whose first order used it].
 *
 * cohorts: by month of first order:
 *   n new customers, nSub (first order carried a season ticket), nSingle,
 *   t1 tickets and rev1 dollars on the first order, e60/e90 the customers
 *   whose first order is old enough to have had 60/90 days to come back,
 *   r60/r90 how many of those placed another order on a later day within
 *   that time, s60/s90 how many bought a different show within it, the same
 *   four for single-ticket first orders (sE60, sR60, sS60, ...), and
 *   offers: offerId -> [n, e60, r60, s60, e90, r90, s90] for customers whose
 *   first order used that offer.
 *
 * months: per calendar month of ordering: orders, customers active, new
 *   customers among them, tickets, dollars.
 */

import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import crypto from 'crypto';
import { spektrixGet } from '@/lib/spektrix';
import { dateWindows, addDays, daysBetween } from '@/lib/historyFill';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const REQUEST_TIMEOUT_MS = 40000;
const CALL_BUDGET_MS = 95000;
const MAX_RANGE_DAYS = 1200;
const MAX_PAGES_PER_WINDOW = 40;
const PAGE_SIZE = 200;
const WINDOW_DAYS = 2;
const WINDOW_TTL_SECONDS = 24 * 3600;
const META_TTL_SECONDS = 24 * 3600;

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
 * One order, reduced to what the sums need:
 *   [id, localDay, customerId, subLines, { "event|type|face|price|offer": [n, discount, total] }]
 * The customer id stays inside the cache and this function's memory.
 */
function compactOrder(o) {
  const tix = {};
  for (const t of o?.tickets || []) {
    const eventId = idOf(t?.event);
    if (!eventId) continue;
    const typeId = idOf(t?.type) || idOf(t?.ticketType);
    const key = `${eventId}|${typeId}|${cents(t?.originalPrice)}|${cents(t?.price)}|${idOf(t?.offer)}`;
    const a = tix[key] || (tix[key] = [0, 0, 0]);
    a[0] += 1;
    a[1] += cents(t?.discount);
    a[2] += cents(t?.total);
  }
  const customer = idOf(o?.customer) || (typeof o?.customerId === 'string' ? o.customerId : '');
  return [
    o?.id || '',
    day(o?.firstTransactionDate) || day(o?.firstTransactionDateUtc),
    customer,
    (o?.ticketSubscriptions || []).length,
    tix,
  ];
}

function keysOf(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return typeof v;
  return Object.keys(v).slice(0, 40);
}

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
      if (!out.shape) out.shape = { order: keysOf(o), customer: keysOf(o?.customer) };
    }
    if (r.orders.length < PAGE_SIZE) { out.status = 'done'; return out; }
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
        if (win.status !== 'done') throw new Incomplete(win);
        return win;
      },
      ['patron-scan', 'v1', from, to],
      { revalidate: WINDOW_TTL_SECONDS, tags: ['patron-scan'] },
    )();
  } catch (err) {
    if (err instanceof Incomplete) return err.win;
    return { from, to, status: `error: ${err?.message || 'unknown'}`, pages: 0, fetched: 0, orders: [], shape: null };
  }
}

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

/** Name and run dates for an event, closed shows included. */
const eventMeta = (id) => unstable_cache(
  async () => {
    let name = null, first = null, last = null, perfs = null;
    try {
      const e = await spektrixGet(`/events/${id}`);
      name = e?.name ?? null;
      first = e?.firstInstanceDateTime ? e.firstInstanceDateTime.slice(0, 10) : null;
      last = e?.lastInstanceDateTime ? e.lastInstanceDateTime.slice(0, 10) : null;
    } catch { /* fall through to the instances */ }
    if (!first) {
      try {
        const raw = await spektrixGet(`/events/${id}/instances`);
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const starts = list.filter(i => !i?.cancelled).map(i => (i?.start || '').slice(0, 10)).filter(Boolean).sort();
        perfs = starts.length;
        first = starts[0] || null;
        last = starts[starts.length - 1] || null;
      } catch { /* leave null */ }
    }
    return { name, first, last, perfs };
  },
  ['patron-scan-event', 'v1', id],
  { revalidate: META_TTL_SECONDS },
)();

const ticketTypes = () => unstable_cache(
  async () => {
    const raw = await spektrixGet('/ticket-types');
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    return Object.fromEntries(list.map(t => [t?.id, t?.name || '']));
  },
  ['patron-scan-ticket-types', 'v1'],
  { revalidate: META_TTL_SECONDS },
)();

function classify(typeName, face) {
  const n = (typeName || '').toLowerCase();
  if (n.includes('comp') || face === 0) return 'comp';
  if (n.includes('group')) return 'grp';
  if (n.includes('student')) return 'stu';
  if (n.includes('senior')) return 'sen';
  return 'adu';
}

function timingBucket(orderDay, openDay, lastDay) {
  if (!openDay) return 'unk';
  const d = daysBetween(orderDay, openDay); // positive = before opening
  if (d >= 60) return 'pre60';
  if (d >= 30) return 'd30_59';
  if (d >= 8) return 'd8_29';
  if (d >= 0) return 'd0_7';
  if (!lastDay || orderDay <= lastDay) return 'run';
  return 'post';
}

const dollars = (c) => Math.round(c / 100);

export async function GET(request) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  try {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(from || '') || !iso.test(to || '') || to < from) {
      return NextResponse.json({ error: 'from and to required as YYYY-MM-DD, from <= to' }, { status: 400 });
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `range limited to ${MAX_RANGE_DAYS} days per call` }, { status: 400 });
    }
    const conc = Math.min(12, Math.max(1, parseInt(searchParams.get('conc') || '8', 10) || 8));
    const wantEvents = searchParams.get('events') !== '0';
    const wantCohorts = searchParams.get('cohorts') !== '0';
    const minTickets = Math.max(0, parseInt(searchParams.get('min') || '0', 10) || 0);
    const debug = !!searchParams.get('debug');

    const today = new Date().toISOString().slice(0, 10);
    const qFrom = addDays(from, -1);
    const padTo = addDays(to, 1);
    const qTo = padTo > addDays(today, 1) ? addDays(today, 1) : padTo;
    const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
    const deadline = started + CALL_BUDGET_MS;
    const windows = dateWindows(qFrom, qTo, WINDOW_DAYS);
    const scans = await pool(windows, conc, w => cachedWindow(base, w.from, w.to, deadline));

    // De-duplicate across windows and keep the orders first placed in range.
    const seen = new Set();
    const orders = [];
    let shape = null;
    const report = [];
    let anonOrders = 0;
    for (const s of scans) {
      for (const row of s.orders) {
        const [id, local, customer] = row;
        if (id) { if (seen.has(id)) continue; seen.add(id); }
        if (!local || local < from || local > to) continue;
        if (!customer) anonOrders++;
        orders.push(row);
      }
      if (s.shape && !shape) shape = s.shape;
      report.push({ from: s.from, to: s.to, status: s.status, pages: s.pages, fetched: s.fetched, kept: s.orders.length });
    }
    const incomplete = report.filter(w => w.status !== 'done').map(w => `${w.from}..${w.to}: ${w.status}`);
    orders.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

    // First order per customer, and every order day and event per customer.
    const byCustomer = new Map(); // id -> { first: row, days: [], events: Map(eventId -> firstDay) }
    for (const row of orders) {
      const customer = row[2];
      if (!customer) continue;
      let c = byCustomer.get(customer);
      if (!c) { c = { first: row, days: [], events: new Map() }; byCustomer.set(customer, c); }
      c.days.push(row[1]);
      for (const key of Object.keys(row[4])) {
        const eventId = key.split('|')[0];
        if (!c.events.has(eventId) || c.events.get(eventId) > row[1]) c.events.set(eventId, row[1]);
      }
    }

    const types = await ticketTypes().catch(() => ({}));

    // Per-event sums.
    const ev = {};
    const touch = (eventId) => ev[eventId] || (ev[eventId] = {
      t: 0, comp: 0, paid: 0, sub: 0, single: 0, adu: 0, sen: 0, stu: 0, grp: 0,
      rev: 0, disc: 0, orders: 0, cust: new Set(), anon: 0, nc: 0, nct: 0, ncRet: 0,
      timing: {}, offers: {}, _firstDays: [],
    });
    const monthly = {};
    const monthOf = (d) => d.slice(0, 7);

    for (const row of orders) {
      const [id, local, customer, subs, tix] = row;
      const isSub = subs > 0;
      const c = customer ? byCustomer.get(customer) : null;
      const isFirst = !!c && c.first[0] === id;
      const m = monthly[monthOf(local)] || (monthly[monthOf(local)] = { orders: 0, cust: new Set(), newCust: 0, t: 0, rev: 0 });
      m.orders++;
      if (customer) m.cust.add(customer);
      if (isFirst) m.newCust++;
      const eventsOnOrder = new Set();
      for (const [key, [n, disc, total]] of Object.entries(tix)) {
        const [eventId, typeId, faceStr, , offerId] = key.split('|');
        const face = parseInt(faceStr, 10) || 0;
        const e = touch(eventId);
        const cls = classify(types[typeId], face);
        e.t += n;
        m.t += n;
        if (cls === 'comp') { e.comp += n; }
        else {
          e.paid += n;
          e.rev += total;
          m.rev += total;
          e.disc += disc;
          if (isSub) e.sub += n; else e.single += n;
          e[cls] += n;
        }
        if (!customer) e.anon += n;
        if (offerId) {
          const o = e.offers[offerId] || (e.offers[offerId] = [0, 0, 0, 0]);
          o[0] += n; o[1] += disc; o[2] += total;
          if (isFirst) o[3] += 1;
        }
        if (isFirst) e.nct += n;
        eventsOnOrder.add(eventId);
      }
      for (const eventId of eventsOnOrder) {
        const e = touch(eventId);
        e.orders++;
        if (customer) e.cust.add(customer);
        if (isFirst) {
          e.nc++;
          // Did this first-time buyer later buy a different show?
          let returned = false;
          for (const [otherId, firstDay] of c.events) {
            if (otherId !== eventId && firstDay > local) { returned = true; break; }
          }
          if (returned) e.ncRet++;
        }
        e._firstDays.push(local);
      }
    }

    // Resolve names and run dates, then bucket timing against opening night.
    const ids = Object.keys(ev).filter(id => ev[id].t >= minTickets);
    const metas = await pool(ids, 6, async (id) => [id, await eventMeta(id).catch(() => ({ name: null, first: null, last: null }))]);
    const metaById = Object.fromEntries(metas);
    const events = {};
    if (wantEvents) {
      for (const id of ids) {
        const e = ev[id];
        const meta = metaById[id] || {};
        const timing = {};
        // Timing is by order, re-walked so each ticket lands in a bucket.
        for (const row of orders) {
          for (const [key, [n]] of Object.entries(row[4])) {
            if (key.split('|')[0] !== id) continue;
            const b = timingBucket(row[1], meta.first, meta.last);
            timing[b] = (timing[b] || 0) + n;
          }
        }
        const offers = {};
        for (const [oid, [n, disc, total, nc]] of Object.entries(e.offers)) offers[oid] = [n, dollars(disc), dollars(total), nc];
        events[id] = {
          name: meta.name, first: meta.first, last: meta.last,
          t: e.t, comp: e.comp, paid: e.paid, sub: e.sub, single: e.single,
          adu: e.adu, sen: e.sen, stu: e.stu, grp: e.grp,
          rev: dollars(e.rev), disc: dollars(e.disc),
          orders: e.orders, cust: e.cust.size, anon: e.anon,
          nc: e.nc, nct: e.nct, ncRet: e.ncRet,
          firstOrder: e._firstDays.length ? e._firstDays.reduce((a, b) => (a < b ? a : b)) : null,
          timing, offers,
        };
      }
    }

    // Cohorts by month of first order.
    const cohorts = {};
    if (wantCohorts) {
      for (const [, c] of byCustomer) {
        const [, firstDay, , subs, tix] = c.first;
        const month = monthOf(firstDay);
        const k = cohorts[month] || (cohorts[month] = {
          n: 0, nSub: 0, nSingle: 0, t1: 0, rev1: 0,
          e60: 0, r60: 0, s60: 0, e90: 0, r90: 0, s90: 0,
          sE60: 0, sR60: 0, sS60: 0, sE90: 0, sR90: 0, sS90: 0,
          offers: {},
        });
        k.n++;
        const isSub = subs > 0;
        if (isSub) k.nSub++; else k.nSingle++;
        const firstEvents = new Set();
        const firstOffers = new Set();
        for (const [key, [n, , total]] of Object.entries(tix)) {
          const [eventId, typeId, faceStr, , offerId] = key.split('|');
          k.t1 += n;
          if (classify(types[typeId], parseInt(faceStr, 10) || 0) !== 'comp') k.rev1 += total;
          firstEvents.add(eventId);
          if (offerId) firstOffers.add(offerId);
        }
        const later = (n) => {
          const limit = addDays(firstDay, n);
          const eligible = limit <= to;
          const repeat = eligible && c.days.some(d => d > firstDay && d <= limit);
          let show = false;
          if (eligible) for (const [eventId, d] of c.events) if (!firstEvents.has(eventId) && d > firstDay && d <= limit) { show = true; break; }
          return { eligible, repeat, show };
        };
        const l60 = later(60), l90 = later(90);
        if (l60.eligible) { k.e60++; if (l60.repeat) k.r60++; if (l60.show) k.s60++; if (!isSub) { k.sE60++; if (l60.repeat) k.sR60++; if (l60.show) k.sS60++; } }
        if (l90.eligible) { k.e90++; if (l90.repeat) k.r90++; if (l90.show) k.s90++; if (!isSub) { k.sE90++; if (l90.repeat) k.sR90++; if (l90.show) k.sS90++; } }
        for (const oid of firstOffers) {
          const o = k.offers[oid] || (k.offers[oid] = [0, 0, 0, 0, 0, 0, 0]);
          o[0]++;
          if (l60.eligible) { o[1]++; if (l60.repeat) o[2]++; if (l60.show) o[3]++; }
          if (l90.eligible) { o[4]++; if (l90.repeat) o[5]++; if (l90.show) o[6]++; }
        }
      }
      for (const k of Object.values(cohorts)) k.rev1 = dollars(k.rev1);
    }

    const months = {};
    for (const [m, v] of Object.entries(monthly).sort()) months[m] = { orders: v.orders, cust: v.cust.size, newCust: v.newCust, t: v.t, rev: dollars(v.rev) };

    return NextResponse.json({
      from, to, queried: `${qFrom}..${qTo}`,
      complete: incomplete.length === 0,
      incomplete,
      orders: orders.length, customers: byCustomer.size, anonOrders,
      events: wantEvents ? events : undefined,
      cohorts: wantCohorts ? Object.fromEntries(Object.entries(cohorts).sort()) : undefined,
      months,
      ...(debug ? { windows: report, shape } : {}),
      ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}
