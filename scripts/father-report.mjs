#!/usr/bin/env node
/**
 * Post-close ticketing baseline for The Father: A Tragic Farce.
 *
 * Pulls five reports per show from Spektrix API v3 (system-owner mode) and
 * writes one workbook plus a factual data_notes.md:
 *
 *   A. Pacing curve, by booking date, normalised to days from opening
 *   B. By performance, one row per instance
 *   C. Buyer file, one row per order (The Father only) with a segment rollup
 *   D. Segment rollup for each comparison show
 *   E. Web sales source probe
 *
 * Usage
 *   node scripts/father-report.mjs --catalogue            list events by season, exit
 *   node scripts/father-report.mjs                        full run with the default show list
 *   node scripts/father-report.mjs --shows "A,B,C"        override the comparison list
 *   node scripts/father-report.mjs --fixture file.json    offline run against a fixture
 *
 * Options
 *   --from YYYY-MM-DD   first booking date scanned for order history (default 2019-01-01)
 *   --out DIR           output folder (default output)
 *   --father NAME       event name for the target show (default "The Father")
 *   --no-cache          ignore output/cache and refetch
 *
 * Env: SPEKTRIX_CLIENT_NAME, SPEKTRIX_API_USER, SPEKTRIX_API_KEY, the same three
 * the dashboard uses. Node 22+. Behind a proxy set NODE_USE_ENV_PROXY=1.
 *
 * Reuses the connector in src/lib/spektrix.js and the ticket rules in
 * src/lib/historyFill.js rather than re-deriving either.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  getEvents, findEvent, getInstanceAvailability, spektrixGet, spektrixGetAll,
} from '../src/lib/spektrix.js';
import { COMP_TYPE_IDS, orderDateOf, addDays, daysBetween, WINDOW_DAYS } from '../src/lib/historyFill.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FATHER_DEFAULT = 'The Father';

// Comparison set. Two named by the brief, three lesser-known straight plays
// from the last three seasons chosen from the season data (see data_notes.md).
const DEFAULT_COMPARISON = [
  'Misery',
  "Who's Afraid of Virginia Woolf",
  'The Cake',
  'What the Constitution Means to Me',
  'Stones in His Pockets',
];

// Short tab prefixes. Anything not listed gets a slug from its first word.
const SHORT_NAMES = {
  'the father': 'Father',
  'misery': 'Misery',
  "who's afraid of virginia woolf": 'Woolf',
  'the cake': 'Cake',
  'what the constitution means to me': 'Constitution',
  'stones in his pockets': 'Stones',
  'the lifespan of a fact': 'Lifespan',
};

// Planned send dates. Confirm against Constant Contact before publishing.
const EMAIL_MARKERS = {
  '2026-07-28': 'E1 super fans',
  '2026-08-04': 'E2 full list; paid social launch',
  '2026-08-11': 'E3',
  '2026-08-18': 'E4 lapsed segment',
  '2026-08-24': 'THURS15 paid launch',
  '2026-08-25': 'E5',
  '2026-08-28': 'Opening',
  '2026-09-02': 'E6',
  '2026-09-09': 'E7',
};

const PROMO_OF_INTEREST = ['THURS15', 'MAIL', 'ANDRE5'];
const THURS15_EXPECTED_DATES = ['2026-09-03', '2026-09-10'];

const SCAN_CONCURRENCY = 4;      // parallel order windows, matches the dashboard
const CUSTOMER_CONCURRENCY = 6;
const CATALOGUE_SINCE = '2023-07-01'; // three seasons back from 26-27

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(args.out || 'output');
const CACHE = path.join(OUT, 'cache');
const SCAN_FROM = args.from || '2019-01-01';
const FATHER = args.father || FATHER_DEFAULT;
const COMPARISON = args.shows ? args.shows.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_COMPARISON;
const TODAY = pacificToday();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const round2 = v => Math.round(v * 100) / 100;
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dowOf(dateStr) {
  return DOW[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
}

function seasonOf(dateStr) {
  if (!dateStr) return '';
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/**
 * Same four-day windows as the dashboard's history fill, without its
 * 64-window guard: that guard bounds a single dashboard request, but a seven
 * year history scan needs several hundred windows.
 */
function windowsBetween(from, to, days = WINDOW_DAYS) {
  const out = [];
  for (let cur = from; cur <= to;) {
    const end = addDays(cur, days - 1);
    out.push({ from: cur, to: end > to ? to : end });
    cur = addDays(end, 1);
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function shortNameFor(name, taken) {
  const key = (name || '').toLowerCase();
  let short = SHORT_NAMES[key];
  if (!short) {
    const words = key.replace(/[^a-z0-9 ]+/g, ' ').replace(/^(the|a|an) /, '').trim().split(/\s+/);
    short = (words[0] || 'Show').replace(/^./, c => c.toUpperCase());
  }
  let candidate = short, n = 2;
  while (taken.has(candidate)) candidate = `${short}${n++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Drop anything that looks like personal data before caching. A nested
 * customer object is reduced to its id; `name` is kept elsewhere because
 * ticket types, promotions and subscriptions are identified by it.
 */
const PII_KEY = /^(firstName|lastName|email|emailAddress|phone|mobile|telephone|address|addresses|addressLine\d?|town|city|county|country|postcode|postCode|zip|zipCode|dateOfBirth|birthDate)$/i;
function stripPii(value) {
  if (Array.isArray(value)) return value.map(stripPii);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEY.test(k)) continue;
      if (k === 'customer' && v && typeof v === 'object') { out[k] = { id: v.id }; continue; }
      out[k] = stripPii(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Data source: live API or fixture
// ---------------------------------------------------------------------------

let fixture = null;
if (args.fixture) {
  fixture = JSON.parse(await readFile(path.resolve(args.fixture), 'utf8'));
} else {
  for (const k of ['SPEKTRIX_CLIENT_NAME', 'SPEKTRIX_API_USER', 'SPEKTRIX_API_KEY']) {
    if (!process.env[k]) {
      console.error(`Missing ${k}. Set the three SPEKTRIX_* variables or pass --fixture.`);
      process.exit(2);
    }
  }
}

const notes = {
  runAt: new Date().toISOString(),
  today: TODAY,
  mode: fixture ? 'fixture' : 'live',
  endpoints: [],
  incomplete: [],
  judgments: [],
  fields: { order: new Set(), ticket: new Set(), customer: new Set(), ticketType: new Map() },
};
const endpoint = (s) => { if (!notes.endpoints.includes(s)) notes.endpoints.push(s); };

async function apiEvents() {
  endpoint('GET /events (paged, pageSize 200)');
  if (fixture) return fixture.events;
  return getEvents();
}

async function apiAvailability(eventId) {
  endpoint('GET /events/{id}/availability?start_from=2015-01-01&start_to=2030-12-31');
  if (fixture) return fixture.availability?.[eventId] || [];
  return getInstanceAvailability(eventId);
}

async function apiInstances(eventId) {
  endpoint('GET /events/{id}/instances');
  if (fixture) return fixture.instances?.[eventId] || [];
  try {
    const raw = await spektrixGetAll(`/events/${eventId}/instances`);
    return raw.map(i => ({
      id: i.id, dt: (i.start || '').slice(0, 16).replace('T', ' '),
      capacity: i.capacity ?? i.totalCapacity ?? null, cancelled: !!i.cancelled,
    }));
  } catch (err) {
    notes.incomplete.push(`instances for event ${eventId}: ${err.message}`);
    return [];
  }
}

async function apiOrdersWindow(from, to) {
  endpoint('GET /orders?DateFrom=&DateTo= (4-day windows, paged, pageSize 200)');
  if (fixture) {
    return (fixture.orders || []).filter(o => { const d = orderDateOf(o); return d >= from && d <= to; });
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await spektrixGetAll(`/orders?DateFrom=${from}&DateTo=${to}`);
    } catch (err) {
      lastErr = err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  notes.incomplete.push(`orders ${from}..${to}: ${lastErr?.message || 'failed'} after 4 attempts`);
  return null;
}

async function apiCustomer(id) {
  endpoint('GET /customers/{id}');
  if (fixture) return fixture.customers?.[id] || null;
  try {
    return await spektrixGet(`/customers/${id}`);
  } catch (err) {
    notes.incomplete.push(`customer ${id}: ${err.message}`);
    return null;
  }
}

async function cached(name, producer) {
  const file = path.join(CACHE, name);
  if (!args['no-cache'] && !fixture && existsSync(file)) {
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const value = await producer();
  if (!fixture) {
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function catalogueRows(events, since = CATALOGUE_SINCE) {
  return events
    .filter(e => e.name && e.firstInstanceDateTime && e.firstInstanceDateTime.slice(0, 10) >= since)
    .map(e => ({
      season: seasonOf(e.firstInstanceDateTime.slice(0, 10)),
      name: e.name,
      eventId: e.id,
      firstInstance: e.firstInstanceDateTime.slice(0, 10),
      lastInstance: (e.lastInstanceDateTime || e.firstInstanceDateTime).slice(0, 10),
      instanceCount: e.instanceCount ?? e.numberOfInstances ?? null,
    }))
    .sort((a, b) => a.firstInstance.localeCompare(b.firstInstance));
}

// ---------------------------------------------------------------------------
// Ticket classification
// ---------------------------------------------------------------------------

/**
 * single | subscription | comp | returned
 *
 * Comp: ticket type in the dashboard's comp list, or a type name containing
 * "comp", or a zero price on a ticket outside a subscription order.
 * Subscription: the ticket references a subscription, or the order carries
 * ticketSubscriptions (the rule the dashboard's ticket-mix view uses).
 * Returned: the ticket carries a status or flag saying it was returned or
 * cancelled. Probed, not assumed; the notes say whether any such flag exists.
 */
function classifyTicket(t, order) {
  const typeId = t?.type?.id || t?.ticketType?.id || '';
  const typeName = t?.type?.name || t?.ticketType?.name || '';
  const status = String(t?.status ?? '').toLowerCase();
  if (t?.returned === true || t?.cancelled === true || /return|cancel|refund/.test(status)) return 'returned';
  if (COMP_TYPE_IDS.has(typeId) || /\bcomp/i.test(typeName)) return 'comp';
  const subRef = t?.ticketSubscription || t?.subscription || t?.ticketSubscriptionId || t?.subscriptionId;
  const orderHasSub = Array.isArray(order?.ticketSubscriptions) && order.ticketSubscriptions.length > 0;
  if (subRef || orderHasSub) return 'subscription';
  if (num(t?.originalPrice) === 0 && num(t?.price) === 0) return 'comp';
  return 'single';
}

function ticketRevenue(t) {
  if (t?.price !== undefined && t?.price !== null) return num(t.price);
  if (t?.total !== undefined && t?.total !== null) return num(t.total);
  return num(t?.originalPrice);
}

const eventIdOf = t => (typeof t?.event === 'string' ? t.event : t?.event?.id) || '';
const instanceIdOf = t => (typeof t?.instance === 'string' ? t.instance : t?.instance?.id) || '';

// Promo, channel and web-source fields are not documented in the code base and
// the docs were unreachable when this was written, so they are discovered from
// the payload: a fixed list of likely names first, then any key that matches.
const PROMO_KEYS = ['promoCode', 'promotionCode', 'promotion', 'promo', 'offer', 'offerName', 'discountCode', 'code'];
const PROMO_RX = /promo|offer|voucher|discount/i;
const CHANNEL_KEYS = ['salesChannel', 'channel', 'source', 'origin', 'saleSource', 'bookingChannel', 'createdBy', 'user', 'userName', 'agent'];
const CHANNEL_RX = /channel|source|origin|createdBy|user|agent|terminal|till|online|web/i;
const SOURCE_RX = /utm|referr|campaign|medium|gclid|fbclid|tracking/i;

function readLabel(v) {
  if (v === null || v === undefined || v === false) return '';
  if (typeof v === 'object') return String(v.code ?? v.name ?? v.id ?? '');
  return String(v);
}

function pickField(obj, keys, rx) {
  if (!obj || typeof obj !== 'object') return { key: '', value: '' };
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && readLabel(obj[k]) !== '') return { key: k, value: readLabel(obj[k]) };
  }
  for (const k of Object.keys(obj)) {
    if (rx.test(k) && obj[k] !== undefined && obj[k] !== null && readLabel(obj[k]) !== '') return { key: k, value: readLabel(obj[k]) };
  }
  return { key: '', value: '' };
}

function promoOf(order, t) {
  const fromTicket = pickField(t, PROMO_KEYS, PROMO_RX);
  if (fromTicket.value) return fromTicket;
  return pickField(order, PROMO_KEYS, PROMO_RX);
}

function channelOf(order) {
  const raw = pickField(order, CHANNEL_KEYS, CHANNEL_RX);
  return { key: raw.key, raw: raw.value, label: normaliseChannel(raw.value) };
}

function normaliseChannel(v) {
  const s = (v || '').toLowerCase();
  if (!s) return 'unknown';
  if (/web|online|internet|api/.test(s)) return 'web';
  if (/phone|tele|call/.test(s)) return 'phone';
  if (/box|counter|walk|sales|admin|front/.test(s)) return 'box office';
  return `other: ${v}`;
}

// ---------------------------------------------------------------------------
// Order scan
// ---------------------------------------------------------------------------

async function scanAllOrders(from, to) {
  const windows = windowsBetween(from, to);
  const seen = new Set();
  const orders = [];
  let done = 0;
  await mapLimit(windows, SCAN_CONCURRENCY, async (w) => {
    const page = await apiOrdersWindow(w.from, w.to);
    done++;
    if (done % 25 === 0 || done === windows.length) {
      process.stderr.write(`  orders: ${done}/${windows.length} windows, ${orders.length} orders\n`);
    }
    if (!page) return;
    for (const o of page) {
      const id = o?.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      for (const k of Object.keys(o || {})) notes.fields.order.add(k);
      for (const t of o?.tickets || []) for (const k of Object.keys(t || {})) notes.fields.ticket.add(k);
      orders.push(stripPii(o));
    }
  });
  return orders;
}

// ---------------------------------------------------------------------------
// Per-show pull
// ---------------------------------------------------------------------------

async function resolveShow(events, name) {
  const event = findEvent(events, name);
  if (!event) {
    notes.incomplete.push(`show "${name}" not found in the Spektrix event list`);
    return null;
  }
  const availability = await apiAvailability(event.id);
  const instances = await apiInstances(event.id);
  // Merge: availability gives capacity and current sold; instances fills in any
  // performance the availability call did not return (past runs, in some
  // configurations) and flags cancellations.
  const byId = new Map();
  for (const a of availability) byId.set(a.id, { id: a.id, dt: a.dt, cap: a.cap, availSold: a.sold, cancelled: false });
  for (const i of instances) {
    if (!i.id) continue;
    const cur = byId.get(i.id);
    if (cur) { cur.cancelled = i.cancelled; if (!cur.cap && i.capacity) cur.cap = i.capacity; }
    else byId.set(i.id, { id: i.id, dt: i.dt, cap: i.capacity ?? null, availSold: null, cancelled: i.cancelled });
  }
  const list = [...byId.values()].filter(i => i.dt).sort((a, b) => a.dt.localeCompare(b.dt));
  if (!availability.length) notes.incomplete.push(`${event.name}: availability endpoint returned no instances; capacity taken from /instances or left blank`);
  return {
    name: event.name, requestedName: name, eventId: event.id,
    open: (event.firstInstanceDateTime || list[0]?.dt || '').slice(0, 10),
    close: (event.lastInstanceDateTime || list.at(-1)?.dt || '').slice(0, 10),
    instances: list,
  };
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

/** Flatten every ticket in the scan into one row with its classification. */
function flattenTickets(orders) {
  const rows = [];
  for (const o of orders) {
    const bookingDate = orderDateOf(o);
    if (!bookingDate) continue;
    const customerId = o?.customer?.id || o?.customerId || '';
    const channel = channelOf(o);
    for (const t of o?.tickets || []) {
      const cls = classifyTicket(t, o);
      const typeName = t?.type?.name || t?.ticketType?.name || '';
      const tk = `${cls}|${typeName || '(no type name)'}`;
      notes.fields.ticketType.set(tk, (notes.fields.ticketType.get(tk) || 0) + 1);
      const promo = promoOf(o, t);
      rows.push({
        orderId: o?.id || '', customerId, bookingDate,
        eventId: eventIdOf(t), instanceId: instanceIdOf(t),
        instanceStart: (typeof t?.instance === 'object' && t?.instance?.start) ? t.instance.start.slice(0, 10) : '',
        cls, revenue: cls === 'comp' || cls === 'returned' ? 0 : ticketRevenue(t),
        originalPrice: num(t?.originalPrice),
        promo: promo.value.toUpperCase(), promoKey: promo.key,
        channel: channel.label, channelRaw: channel.raw, channelKey: channel.key,
        inSubOrder: Array.isArray(o?.ticketSubscriptions) && o.ticketSubscriptions.length > 0,
      });
    }
  }
  return rows;
}

function buildPacing(show, tickets, markers) {
  const mine = tickets.filter(t => t.eventId === show.eventId && t.cls !== 'returned');
  if (!mine.length) { notes.incomplete.push(`${show.name}: no tickets found in the order scan`); }
  const dates = mine.map(t => t.bookingDate).sort();
  const onSale = dates[0] || '';
  const firstSingle = mine.filter(t => t.cls === 'single').map(t => t.bookingDate).sort()[0] || '';
  const start = onSale || show.open;
  const end = show.close > TODAY ? TODAY : show.close;
  const byDay = {};
  for (const t of mine) {
    const d = byDay[t.bookingDate] || (byDay[t.bookingDate] = { single: 0, singleRev: 0, sub: 0, subRev: 0, comp: 0 });
    if (t.cls === 'single') { d.single++; d.singleRev += t.revenue; }
    else if (t.cls === 'subscription') { d.sub++; d.subRev += t.revenue; }
    else if (t.cls === 'comp') d.comp++;
  }
  const rows = [];
  let cs = 0, csr = 0, cb = 0, cbr = 0, cc = 0;
  for (let cur = start, guard = 0; cur <= end && guard < 2000; cur = addDays(cur, 1), guard++) {
    const d = byDay[cur] || { single: 0, singleRev: 0, sub: 0, subRev: 0, comp: 0 };
    cs += d.single; csr += d.singleRev; cb += d.sub; cbr += d.subRev; cc += d.comp;
    rows.push({
      date: cur, daysFromOpening: daysBetween(show.open, cur), dow: dowOf(cur),
      singleDay: d.single, singleCum: cs, singleRevDay: round2(d.singleRev), singleRevCum: round2(csr),
      subDay: d.sub, subCum: cb, subRevCum: round2(cbr),
      paidCum: cs + cb, paidRevCum: round2(csr + cbr),
      compDay: d.comp, compCum: cc,
      marker: markers?.[cur] || '',
    });
  }
  return { onSale, firstSingle, rows, totals: { single: cs, singleRev: round2(csr), sub: cb, subRev: round2(cbr), comp: cc } };
}

function buildByPerf(show, tickets, isFather) {
  const mine = tickets.filter(t => t.eventId === show.eventId && t.cls !== 'returned');
  const byInst = new Map();
  for (const i of show.instances) byInst.set(i.id, { ...i, single: 0, sub: 0, comp: 0, revenue: 0, thurs15: 0, otherCodes: {} });
  let unplaced = 0;
  for (const t of mine) {
    let row = byInst.get(t.instanceId);
    if (!row) {
      if (!t.instanceId) { unplaced++; continue; }
      row = { id: t.instanceId, dt: t.instanceStart ? `${t.instanceStart} ??:??` : '', cap: null, availSold: null, cancelled: false, single: 0, sub: 0, comp: 0, revenue: 0, thurs15: 0, otherCodes: {} };
      byInst.set(t.instanceId, row);
      notes.incomplete.push(`${show.name}: tickets reference instance ${t.instanceId} which the instance list did not return`);
    }
    if (t.cls === 'single') { row.single++; row.revenue += t.revenue; }
    else if (t.cls === 'subscription') { row.sub++; row.revenue += t.revenue; }
    else if (t.cls === 'comp') row.comp++;
    if (t.promo) {
      if (t.promo === 'THURS15') row.thurs15++;
      else if (PROMO_OF_INTEREST.includes(t.promo)) row.otherCodes[t.promo] = (row.otherCodes[t.promo] || 0) + 1;
    }
  }
  if (unplaced) notes.incomplete.push(`${show.name}: ${unplaced} tickets carried no instance id and are excluded from the by-performance rows`);
  const rows = [...byInst.values()].sort((a, b) => (a.dt || '').localeCompare(b.dt || '')).map(r => {
    const date = (r.dt || '').slice(0, 10), time = (r.dt || '').slice(11, 16);
    const paid = r.single + r.sub;
    const dow = date ? dowOf(date) : '';
    return {
      instanceId: r.id, date, time, dow, isThursday: dow === 'Thu',
      capacity: r.cap, paidSold: paid, singles: r.single, subAllocations: r.sub, comps: r.comp,
      availabilitySold: r.availSold,
      revenue: round2(r.revenue), pctCapacity: r.cap ? pct(paid, r.cap) : null,
      avgPrice: paid ? round2(r.revenue / paid) : null,
      thurs15: isFather ? r.thurs15 : undefined,
      otherCodes: isFather ? Object.entries(r.otherCodes).map(([k, v]) => `${k}:${v}`).join(', ') : undefined,
      cancelled: r.cancelled,
    };
  });
  if (isFather) {
    const redeemedOn = rows.filter(r => r.thurs15 > 0).map(r => r.date);
    const offDates = redeemedOn.filter(d => !THURS15_EXPECTED_DATES.includes(d));
    notes.judgments.push(`THURS15 redeemed on: ${redeemedOn.join(', ') || 'none found'}${offDates.length ? ` (outside the Sep 3 / Sep 10 restriction: ${offDates.join(', ')})` : ''}.`);
    const others = {};
    for (const t of mine) if (t.promo && t.promo !== 'THURS15' && PROMO_OF_INTEREST.includes(t.promo)) others[t.promo] = (others[t.promo] || 0) + 1;
    notes.judgments.push(`MAIL / ANDRE5 redemptions on ${show.name}: ${Object.keys(others).length ? Object.entries(others).map(([k, v]) => `${k}=${v}`).join(', ') : 'none found'}.`);
    const allCodes = {};
    for (const t of mine) if (t.promo) allCodes[t.promo] = (allCodes[t.promo] || 0) + 1;
    notes.judgments.push(`All promo values seen on ${show.name} tickets: ${Object.keys(allCodes).length ? Object.entries(allCodes).map(([k, v]) => `${k}=${v}`).join(', ') : 'none'} (field: ${mine.find(t => t.promoKey)?.promoKey || 'no promo field found'}).`);
  }
  return rows;
}

/**
 * Customer history from the whole scan, independent of show: for each
 * customer, every order with at least one non-comp ticket, with the
 * performance dates those tickets were for.
 */
function buildHistory(tickets, instanceDateById) {
  const byCustomer = new Map();
  for (const t of tickets) {
    if (!t.customerId || t.cls === 'comp' || t.cls === 'returned') continue;
    const cust = byCustomer.get(t.customerId) || (byCustomer.set(t.customerId, new Map()), byCustomer.get(t.customerId));
    const ord = cust.get(t.orderId) || (cust.set(t.orderId, { bookingDate: t.bookingDate, instanceDates: new Set(), instanceIds: new Set() }), cust.get(t.orderId));
    const perf = instanceDateById.get(t.instanceId) || t.instanceStart || '';
    if (perf) ord.instanceDates.add(perf);
    if (t.instanceId) ord.instanceIds.add(t.instanceId);
  }
  return byCustomer;
}

function segmentFor(customerId, orderId, bookingDate, history) {
  const cust = history.get(customerId);
  const prior = cust ? [...cust.entries()].filter(([id, o]) => id !== orderId && o.bookingDate < bookingDate) : [];
  const firstEver = cust ? [...cust.values()].map(o => o.bookingDate).sort()[0] : bookingDate;
  const priorOrders = prior.length;
  const priorPerfIds = new Set();
  let lastVisit = '';
  for (const [, o] of prior) {
    for (const d of o.instanceDates) if (d < bookingDate && d > lastVisit) lastVisit = d;
    for (const id of o.instanceIds) priorPerfIds.add(id);
  }
  if (!lastVisit && prior.length) lastVisit = prior.map(([, o]) => o.bookingDate).sort().at(-1);
  let segment;
  if (!prior.length) segment = 'first-time';
  else {
    const gap = daysBetween(lastVisit, bookingDate);
    segment = gap < 365 ? 'active' : gap < 1095 ? 'lapsed 1-3y' : 'dormant 3y+';
  }
  return { firstEver: firstEver < bookingDate ? firstEver : bookingDate, priorOrders, priorPerformances: priorPerfIds.size, lastVisit, segment };
}

function zipOf(customer) {
  if (!customer) return '';
  const cands = [customer.postcode, customer.postCode, customer.zip, customer.zipCode, customer.postalCode,
    customer.address?.postcode, customer.address?.postCode, customer.address?.zip,
    ...(Array.isArray(customer.addresses) ? customer.addresses.map(a => a?.postcode ?? a?.postCode ?? a?.zip) : [])];
  const v = cands.find(x => x !== undefined && x !== null && String(x).trim() !== '');
  return v ? String(v).trim().slice(0, 5) : '';
}

function birthYearOf(customer) {
  if (!customer) return null;
  const cands = [customer.dateOfBirth, customer.birthDate, customer.dob, customer.birthday];
  for (const k of Object.keys(customer)) if (/birth|dob/i.test(k) && !cands.includes(customer[k])) cands.push(customer[k]);
  for (const v of cands) {
    if (!v) continue;
    const m = String(v).match(/(19|20)\d{2}/);
    if (m) return Number(m[0]);
  }
  return null;
}

function ageBand(age) {
  if (age === null || age === undefined) return '';
  if (age < 35) return 'under 35';
  if (age < 55) return '35-54';
  if (age < 65) return '55-64';
  return '65+';
}

function buildBuyerRows(show, tickets, history, customers, instanceDateById) {
  const mine = tickets.filter(t => t.eventId === show.eventId && t.cls !== 'returned');
  const byOrder = new Map();
  for (const t of mine) {
    const o = byOrder.get(t.orderId) || (byOrder.set(t.orderId, {
      orderId: t.orderId, customerId: t.customerId, bookingDate: t.bookingDate,
      instanceDates: new Set(), tickets: 0, singles: 0, subAllocations: 0, comps: 0, revenue: 0,
      channel: t.channel, promos: new Set(),
    }), byOrder.get(t.orderId));
    const perf = instanceDateById.get(t.instanceId) || t.instanceStart || '';
    if (perf) o.instanceDates.add(perf);
    if (t.cls === 'single') { o.tickets++; o.singles++; o.revenue += t.revenue; }
    else if (t.cls === 'subscription') { o.tickets++; o.subAllocations++; o.revenue += t.revenue; }
    else if (t.cls === 'comp') o.comps++;
    if (t.promo) o.promos.add(t.promo);
  }
  const rows = [];
  for (const o of byOrder.values()) {
    const seg = segmentFor(o.customerId, o.orderId, o.bookingDate, history);
    const cust = customers[o.customerId] || null;
    const by = birthYearOf(cust);
    const age = by ? Number(o.bookingDate.slice(0, 4)) - by : null;
    const perfDates = [...o.instanceDates].sort();
    const firstPerf = perfDates[0] || '';
    const zip = zipOf(cust);
    rows.push({
      orderId: o.orderId, customerId: o.customerId, bookingDate: o.bookingDate,
      instanceDate: perfDates.join('; '), leadDays: firstPerf ? daysBetween(o.bookingDate, firstPerf) : null,
      tickets: o.tickets, singles: o.singles, subAllocations: o.subAllocations, comps: o.comps,
      revenue: round2(o.revenue), channel: o.channel, promo: [...o.promos].join('; '),
      zip, local: zip ? (zip.startsWith('93') ? 'local' : 'non-local') : 'unknown',
      birthYear: by, age, ageBand: ageBand(age),
      firstEverBooking: seg.firstEver, priorOrders: seg.priorOrders, priorPerformances: seg.priorPerformances,
      lastVisit: seg.lastVisit, segment: seg.segment,
    });
  }
  return rows.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.orderId.localeCompare(b.orderId));
}

function summarise(rows) {
  const paidRows = rows.filter(r => r.tickets > 0);
  const totalTix = paidRows.reduce((s, r) => s + r.tickets, 0);
  const totalRev = paidRows.reduce((s, r) => s + r.revenue, 0);
  const buyers = new Set(paidRows.map(r => r.customerId).filter(Boolean));
  const block = (label, groupFn, universe = paidRows) => {
    const groups = {};
    for (const r of universe) {
      const g = groupFn(r);
      const cur = groups[g] || (groups[g] = { tickets: 0, revenue: 0, orders: 0, buyers: new Set() });
      cur.tickets += r.tickets; cur.revenue += r.revenue; cur.orders++; if (r.customerId) cur.buyers.add(r.customerId);
    }
    return Object.entries(groups).map(([g, v]) => ({
      section: label, group: g, tickets: v.tickets, ticketShare: pct(v.tickets, totalTix),
      buyers: v.buyers.size, buyerShare: pct(v.buyers.size, buyers.size),
      orders: v.orders, orderShare: pct(v.orders, paidRows.length),
      revenue: round2(v.revenue), revenueShare: pct(v.revenue, totalRev),
    })).sort((a, b) => a.group.localeCompare(b.group));
  };
  const out = [];
  out.push({ section: 'totals', group: 'all paid orders', tickets: totalTix, ticketShare: 100, buyers: buyers.size, buyerShare: 100, orders: paidRows.length, orderShare: 100, revenue: round2(totalRev), revenueShare: 100 });
  out.push(...block('segment', r => r.segment));
  const withAge = paidRows.filter(r => r.age !== null);
  if (withAge.length) {
    out.push(...block('age band', r => r.ageBand, withAge));
    out.push(...block('under 55', r => (r.age < 55 ? 'under 55' : '55+'), withAge));
    out.push({ section: 'age coverage', group: 'orders with a birth year', tickets: withAge.reduce((s, r) => s + r.tickets, 0), ticketShare: pct(withAge.reduce((s, r) => s + r.tickets, 0), totalTix), buyers: new Set(withAge.map(r => r.customerId)).size, buyerShare: pct(new Set(withAge.map(r => r.customerId)).size, buyers.size), orders: withAge.length, orderShare: pct(withAge.length, paidRows.length), revenue: null, revenueShare: null });
  } else {
    out.push({ section: 'age', group: 'no birth year on any buyer record', tickets: 0, ticketShare: null, buyers: 0, buyerShare: null, orders: 0, orderShare: null, revenue: null, revenueShare: null });
  }
  out.push(...block('locality (zip 93xxx)', r => r.local));
  out.push(...block('party size', r => (r.tickets === 2 ? 'pair (exactly 2)' : r.tickets === 1 ? 'single' : '3+')));
  out.push(...block('channel', r => r.channel));
  out.push(...block('lead time', r => (r.leadDays === null ? 'unknown' : r.leadDays <= 7 ? 'final 7 days' : r.leadDays >= 56 ? '8+ weeks out' : '8 days to 8 weeks')));
  return out;
}

function probeWebSource(orders, fatherEventId) {
  const keys = new Map();
  const consider = (obj, where) => {
    for (const k of Object.keys(obj || {})) {
      if (SOURCE_RX.test(k)) {
        const cur = keys.get(`${where}.${k}`) || (keys.set(`${where}.${k}`, { nonEmpty: 0, distinct: new Set() }), keys.get(`${where}.${k}`));
        const v = readLabel(obj[k]);
        if (v) { cur.nonEmpty++; cur.distinct.add(v); }
      }
    }
  };
  let fatherOrders = 0;
  for (const o of orders) {
    const isFather = (o.tickets || []).some(t => eventIdOf(t) === fatherEventId);
    if (!isFather) continue;
    fatherOrders++;
    consider(o, 'order');
    for (const t of o.tickets || []) consider(t, 'ticket');
  }
  const found = [...keys.entries()].map(([k, v]) => ({ field: k, ordersWithValue: v.nonEmpty, distinctValues: v.distinct.size }));
  return { fatherOrders, found, orderKeys: [...notes.fields.order].sort(), ticketKeys: [...notes.fields.ticket].sort() };
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

function addTable(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || Math.max(12, c.header.length + 2) }));
  for (const r of rows) ws.addRow(columns.map(c => (r[c.key] === undefined ? null : r[c.key])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

const PACING_COLS = [
  { header: 'date', key: 'date' }, { header: 'days_from_opening', key: 'daysFromOpening' }, { header: 'dow', key: 'dow', width: 6 },
  { header: 'single_tix_day', key: 'singleDay' }, { header: 'single_tix_cum', key: 'singleCum' },
  { header: 'single_rev_day', key: 'singleRevDay' }, { header: 'single_rev_cum', key: 'singleRevCum' },
  { header: 'sub_alloc_day', key: 'subDay' }, { header: 'sub_alloc_cum', key: 'subCum' }, { header: 'sub_rev_cum', key: 'subRevCum' },
  { header: 'paid_tix_cum (single+sub)', key: 'paidCum', width: 24 }, { header: 'paid_rev_cum', key: 'paidRevCum' },
  { header: 'comp_day', key: 'compDay' }, { header: 'comp_cum', key: 'compCum' },
  { header: 'marker', key: 'marker', width: 34 },
];
const BYPERF_COLS = [
  { header: 'instance_id', key: 'instanceId', width: 30 }, { header: 'date', key: 'date' }, { header: 'time', key: 'time', width: 8 }, { header: 'dow', key: 'dow', width: 6 },
  { header: 'thursday', key: 'isThursday', width: 9 }, { header: 'capacity', key: 'capacity' }, { header: 'paid_sold', key: 'paidSold' },
  { header: 'singles', key: 'singles' }, { header: 'sub_allocations', key: 'subAllocations' }, { header: 'comps', key: 'comps' },
  { header: 'availability_sold (Spektrix seat status)', key: 'availabilitySold', width: 36 },
  { header: 'revenue', key: 'revenue' }, { header: 'pct_capacity', key: 'pctCapacity' }, { header: 'avg_ticket_price', key: 'avgPrice' },
  { header: 'cancelled', key: 'cancelled', width: 10 },
];
const FATHER_BYPERF_COLS = [...BYPERF_COLS.slice(0, -1), { header: 'THURS15_redemptions', key: 'thurs15', width: 20 }, { header: 'other_codes (MAIL, ANDRE5)', key: 'otherCodes', width: 26 }, BYPERF_COLS.at(-1)];
const BUYER_COLS = [
  { header: 'order_id', key: 'orderId', width: 28 }, { header: 'customer_id', key: 'customerId', width: 28 }, { header: 'booking_date', key: 'bookingDate' },
  { header: 'instance_date', key: 'instanceDate', width: 14 }, { header: 'lead_days', key: 'leadDays' },
  { header: 'tickets (paid)', key: 'tickets' }, { header: 'singles', key: 'singles' }, { header: 'sub_allocations', key: 'subAllocations' }, { header: 'comps', key: 'comps' },
  { header: 'revenue', key: 'revenue' }, { header: 'channel', key: 'channel' }, { header: 'promo', key: 'promo' },
  { header: 'zip', key: 'zip', width: 8 }, { header: 'local', key: 'local' }, { header: 'birth_year', key: 'birthYear' }, { header: 'age_at_booking', key: 'age' }, { header: 'age_band', key: 'ageBand' },
  { header: 'first_ever_booking', key: 'firstEverBooking', width: 18 }, { header: 'prior_orders', key: 'priorOrders' }, { header: 'prior_performances', key: 'priorPerformances', width: 18 },
  { header: 'last_visit', key: 'lastVisit' }, { header: 'segment', key: 'segment' },
];
const SUMMARY_COLS = [
  { header: 'section', key: 'section', width: 22 }, { header: 'group', key: 'group', width: 30 },
  { header: 'tickets', key: 'tickets' }, { header: 'ticket_share_pct', key: 'ticketShare' },
  { header: 'buyers', key: 'buyers' }, { header: 'buyer_share_pct', key: 'buyerShare' },
  { header: 'orders', key: 'orders' }, { header: 'order_share_pct', key: 'orderShare' },
  { header: 'revenue', key: 'revenue' }, { header: 'revenue_share_pct', key: 'revenueShare' },
];

async function writeWorkbook(snapshot, file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'scripts/father-report.mjs';
  addTable(wb, 'Catalogue', [
    { header: 'season', key: 'season', width: 8 }, { header: 'name', key: 'name', width: 44 }, { header: 'event_id', key: 'eventId', width: 30 },
    { header: 'first_instance', key: 'firstInstance' }, { header: 'last_instance', key: 'lastInstance' }, { header: 'instance_count', key: 'instanceCount' },
    { header: 'in_report', key: 'inReport' },
  ], snapshot.catalogue);
  for (const s of snapshot.shows) {
    const isFather = s.role === 'father';
    const meta = [{ date: `on_sale: ${s.pacing.onSale || 'unknown'}` , daysFromOpening: `opening: ${s.open}`, dow: '', marker: `first single-ticket booking: ${s.pacing.firstSingle || 'unknown'}; closing: ${s.close}` }];
    addTable(wb, `${s.short}_Pacing`, PACING_COLS, [...meta, ...s.pacing.rows]);
    addTable(wb, `${s.short}_ByPerf`, isFather ? FATHER_BYPERF_COLS : BYPERF_COLS, s.byPerf);
    if (isFather) addTable(wb, `${s.short}_Buyers`, BUYER_COLS, s.buyers);
    addTable(wb, `${s.short}_Segments`, SUMMARY_COLS, s.summary);
  }
  const ws = wb.addWorksheet('Father_WebSource');
  ws.addRow(['Spektrix v3 order fields matching referrer / UTM / campaign / source on The Father orders']).font = { bold: true };
  ws.addRow(['orders scanned for The Father', snapshot.webSource.fatherOrders]);
  ws.addRow([]);
  if (snapshot.webSource.found.length) {
    ws.addRow(['field', 'orders_with_value', 'distinct_values']).font = { bold: true };
    for (const f of snapshot.webSource.found) ws.addRow([f.field, f.ordersWithValue, f.distinctValues]);
  } else {
    ws.addRow(['No referrer, UTM, or campaign-source field exists on the v3 order or ticket resource.']);
  }
  ws.addRow([]);
  ws.addRow(['order keys observed', snapshot.webSource.orderKeys.join(', ')]);
  ws.addRow(['ticket keys observed', snapshot.webSource.ticketKeys.join(', ')]);
  await wb.xlsx.writeFile(file);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function renderNotes(snapshot) {
  const L = [];
  L.push('# data_notes.md');
  L.push('');
  L.push(`Generated ${snapshot.notes.runAt} (${snapshot.notes.mode} mode) by scripts/father-report.mjs. Today (Pacific): ${snapshot.notes.today}.`);
  L.push('');
  L.push('## Spektrix endpoints used');
  L.push('');
  for (const e of snapshot.notes.endpoints) L.push(`- ${e}`);
  L.push(`- Base: https://system.spektrix.com/{client}/api/v3, HMAC-SHA1 signed (system-owner mode), via src/lib/spektrix.js.`);
  L.push(`- Order scan window: ${snapshot.scan.from} to ${snapshot.scan.to}, ${snapshot.scan.windows} four-day windows, ${snapshot.scan.orders} unique orders, ${snapshot.scan.tickets} tickets.`);
  L.push('- No Spektrix UI report (Movement by Event, Sales by Channel) was used. Everything comes from the API.');
  L.push('');
  L.push('## Shows');
  L.push('');
  L.push('| role | requested | Spektrix event | event id | opening | closing | instances | tab prefix |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const s of snapshot.shows) L.push(`| ${s.role} | ${s.requestedName} | ${s.name} | ${s.eventId} | ${s.open} | ${s.close} | ${s.instances.length}${s.instances.some(i => i.cancelled) ? ` (${s.instances.filter(i => i.cancelled).length} cancelled)` : ''} | ${s.short} |`);
  L.push('');
  const father = snapshot.shows.find(s => s.role === 'father');
  if (father) {
    L.push(`Performance count for ${father.name}: ${father.instances.length} instances returned by Spektrix (${father.instances.filter(i => !i.cancelled).length} not cancelled). Dates: ${father.instances.map(i => i.dt).join(', ')}.`);
    L.push(`Capacity per instance as Spektrix reports it: ${[...new Set(father.instances.map(i => i.cap))].join(', ')}. The brief says a 97-seat house; the Spektrix figure is what the pct_capacity column uses.`);
    L.push('');
  }
  L.push('## Comparison shows');
  L.push('');
  for (const c of snapshot.comparisonReasons) L.push(`- ${c}`);
  L.push('');
  L.push('## How tickets were classified');
  L.push('');
  L.push('- Comp: ticket type id in the dashboard comp list (Artist Comp, Sponsor Comps, Volunteer Comp, General Comp), or a type name containing "comp", or a zero original price and zero price on a ticket outside a subscription order. Comps are excluded from every paid figure and reported in their own column.');
  L.push('- Subscription allocation: the ticket references a subscription, or the order carries ticketSubscriptions. This is the rule src/lib/livePacing.js and the ticket-mix route already use. Single tickets bought inside a subscriber order are therefore counted as allocations; the count of such tickets with a non-zero price is below so the size of that effect is visible.');
  L.push('- Single: everything else.');
  L.push('- Returned: only if the ticket carries a status or flag saying returned or cancelled. See the field probe below for whether such a field exists; if none does, returned tickets are whatever Spektrix has already removed from the order.');
  L.push('- Revenue: ticket price after discount (field `price`; `total`, then `originalPrice` as fallbacks). Fees, donations, merchandise and subscription package revenue outside the ticket line are excluded.');
  L.push('- Booking date: order firstTransactionDate (local), the same field src/lib/historyFill.js reads.');
  L.push('- On-sale date: the earliest booking date of any ticket for the event in the scan (allocations included); the first single-ticket booking is reported separately on the pacing tab.');
  L.push('');
  L.push('Ticket type names seen, by class (count):');
  L.push('');
  for (const [k, v] of snapshot.ticketTypes) L.push(`- ${k}: ${v}`);
  L.push(`- Tickets inside subscription orders with a non-zero price: ${snapshot.subOrderPricedTickets}`);
  L.push('');
  L.push('## Segments and derived columns');
  L.push('');
  L.push(`- History depth: bookings from ${snapshot.scan.from}. "First-ever booking" and "prior orders" cannot see anything earlier, so a customer whose only earlier visit predates that is labelled first-time.`);
  L.push('- Prior orders: earlier orders by the same customer id containing at least one non-comp ticket for any event. Prior performances: distinct instances across those orders.');
  L.push('- Last visit: the latest performance date among prior tickets that falls before this booking date; if a prior booking exists but its performance had not happened yet, the prior booking date is used.');
  L.push('- Segment: first-time (no prior order); active (last visit under 365 days before booking); lapsed 1-3y (365 to 1094 days); dormant 3y+ (1095 days or more).');
  L.push('- Age: booking year minus birth year, when the customer record carries a birth date. Age bands: under 35, 35-54, 55-64, 65+.');
  L.push('- Local: zip beginning 93. Zip is the first five characters of the customer postcode.');
  L.push('- Lead time: first performance date on the order minus booking date. Final 7 days: 7 days or fewer. 8+ weeks: 56 days or more.');
  L.push('- Pairs: orders with exactly two paid tickets.');
  L.push('- Customer records fetched: ' + snapshot.customersFetched + ' (ids only; names and emails are never written).');
  L.push('');
  L.push('## Field probe');
  L.push('');
  L.push(`- Sales channel: ${snapshot.channelProbe}`);
  L.push(`- Promo code: ${snapshot.promoProbe}`);
  L.push(`- Web source: ${snapshot.webSource.found.length ? snapshot.webSource.found.map(f => `${f.field} (${f.ordersWithValue} orders)`).join(', ') : 'no referrer, UTM, or campaign-source field on the v3 order or ticket resource; nothing to pull.'}`);
  L.push(`- Customer keys observed: ${snapshot.customerKeys.join(', ') || 'none'}`);
  L.push(`- Order keys observed: ${snapshot.webSource.orderKeys.join(', ')}`);
  L.push(`- Ticket keys observed: ${snapshot.webSource.ticketKeys.join(', ')}`);
  L.push('');
  L.push('## Promo checks');
  L.push('');
  for (const j of snapshot.notes.judgments) L.push(`- ${j}`);
  L.push('');
  L.push('## Email marker dates on Father_Pacing');
  L.push('');
  L.push('Planned dates from the brief. Confirm actual send dates in Constant Contact before relying on them.');
  for (const [d, m] of Object.entries(EMAIL_MARKERS)) L.push(`- ${d}: ${m}`);
  L.push('');
  L.push('## Incomplete data and judgment calls');
  L.push('');
  if (!snapshot.notes.incomplete.length) L.push('- None recorded by the run.');
  for (const i of snapshot.notes.incomplete) L.push(`- ${i}`);
  L.push('- Availability sold (seat status Sold + Scanned) is shown beside the order-scan paid figure on every by-performance tab; the two differ by comps, returns outside the scan window, and any ticket booked before the scan start.');
  L.push('- Google Drive: the workbook and these notes are written to the repo output folder. Copying to the SLO Rep Drive folder is a separate manual step unless a Drive upload tool is configured.');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT, { recursive: true });
  const events = await cached('events.json', apiEvents);
  const catalogue = catalogueRows(events);

  if (args.catalogue) {
    let season = '';
    for (const r of catalogue) {
      if (r.season !== season) { season = r.season; console.log(`\n${season}`); }
      console.log(`  ${r.firstInstance}  to ${r.lastInstance}  ${r.name}${r.instanceCount ? `  (${r.instanceCount} inst)` : ''}`);
    }
    return;
  }

  process.stderr.write('resolving shows\n');
  const requested = [{ name: FATHER, role: 'father' }, ...COMPARISON.map(name => ({ name, role: 'comparison' }))];
  const shows = [];
  const taken = new Set();
  for (const r of requested) {
    const s = await resolveShow(events, r.name);
    if (!s) continue;
    shows.push({ ...s, role: r.role, short: shortNameFor(s.name, taken) });
  }
  if (!shows.find(s => s.role === 'father')) throw new Error(`Target show "${FATHER}" not found`);

  process.stderr.write('scanning orders\n');
  const scanTo = TODAY;
  const orders = await cached(`orders-${SCAN_FROM}-${scanTo}.json`, () => scanAllOrders(SCAN_FROM, scanTo));
  if (fixture || !notes.fields.order.size) {
    for (const o of orders) { for (const k of Object.keys(o || {})) notes.fields.order.add(k); for (const t of o?.tickets || []) for (const k of Object.keys(t || {})) notes.fields.ticket.add(k); }
  }
  const tickets = flattenTickets(orders);

  // Performance dates for every instance any ticket references, so prior
  // visits can be dated. Target shows are already loaded; other events are
  // fetched only when tickets do not carry the instance start themselves.
  const instanceDateById = new Map();
  for (const s of shows) for (const i of s.instances) instanceDateById.set(i.id, i.dt.slice(0, 10));
  const missingEvents = new Set();
  for (const t of tickets) if (t.instanceId && !instanceDateById.has(t.instanceId) && !t.instanceStart && t.eventId) missingEvents.add(t.eventId);
  if (missingEvents.size) {
    process.stderr.write(`fetching instances for ${missingEvents.size} other events\n`);
    const lists = await cached('other-instances.json', () => mapLimit([...missingEvents], SCAN_CONCURRENCY, async id => ({ id, list: await apiInstances(id) })));
    for (const { list } of lists) for (const i of list) if (i.id && i.dt) instanceDateById.set(i.id, i.dt.slice(0, 10));
  }

  const history = buildHistory(tickets, instanceDateById);

  // Customer records for every buyer of every target show: zip and birth year only.
  const buyerIds = new Set();
  for (const s of shows) for (const t of tickets) if (t.eventId === s.eventId && t.customerId) buyerIds.add(t.customerId);
  process.stderr.write(`fetching ${buyerIds.size} customer records\n`);
  const customers = await cached('customers.json', async () => {
    const out = {};
    await mapLimit([...buyerIds], CUSTOMER_CONCURRENCY, async id => {
      const c = await apiCustomer(id);
      if (!c) return;
      for (const k of Object.keys(c)) notes.fields.customer.add(k);
      out[id] = { id, zip: zipOf(c), birthYear: birthYearOf(c) };
    });
    return out;
  });
  if (fixture) for (const c of Object.values(fixture.customers || {})) for (const k of Object.keys(c)) notes.fields.customer.add(k);
  // The cache holds only zip and birth year; adapt the helpers to that shape.
  const slimCustomers = Object.fromEntries(Object.entries(customers).map(([id, c]) => [id, { postcode: c.zip, dateOfBirth: c.birthYear ? String(c.birthYear) : null }]));

  process.stderr.write('building reports\n');
  const fatherEventId = shows.find(s => s.role === 'father').eventId;
  for (const s of shows) {
    const isFather = s.role === 'father';
    s.pacing = buildPacing(s, tickets, isFather ? EMAIL_MARKERS : null);
    s.byPerf = buildByPerf(s, tickets, isFather);
    const buyerRows = buildBuyerRows(s, tickets, history, slimCustomers, instanceDateById);
    s.summary = summarise(buyerRows);
    s.buyers = isFather ? buyerRows : undefined;
  }
  const webSource = probeWebSource(orders, fatherEventId);

  const channelKeys = new Set(tickets.filter(t => t.channelKey).map(t => t.channelKey));
  const channelValues = {};
  for (const t of tickets) if (t.eventId === fatherEventId) channelValues[t.channelRaw || '(blank)'] = (channelValues[t.channelRaw || '(blank)'] || 0) + 1;
  const promoKeys = new Set(tickets.filter(t => t.promoKey).map(t => t.promoKey));

  const inReport = new Set(shows.map(s => s.eventId));
  const snapshot = {
    notes: { ...notes, fields: undefined },
    scan: { from: SCAN_FROM, to: scanTo, windows: windowsBetween(SCAN_FROM, scanTo).length, orders: orders.length, tickets: tickets.length },
    catalogue: catalogue.map(r => ({ ...r, inReport: inReport.has(r.eventId) ? 'yes' : '' })),
    shows,
    webSource,
    ticketTypes: [...notes.fields.ticketType.entries()].sort(),
    subOrderPricedTickets: tickets.filter(t => t.inSubOrder && t.cls === 'subscription' && t.revenue > 0).length,
    customersFetched: Object.keys(customers).length,
    customerKeys: [...notes.fields.customer].sort(),
    channelProbe: channelKeys.size
      ? `read from order field(s) ${[...channelKeys].join(', ')}; raw values on The Father tickets: ${Object.entries(channelValues).map(([k, v]) => `${k}=${v}`).join(', ')}. Mapping: web/online/api -> web; phone/tele/call -> phone; box/counter/walk/sales/admin/front -> box office; anything else kept as "other: value".`
      : 'no field on the v3 order resource names a sales channel. Every order is labelled "unknown" and the channel rollup is empty. Spektrix\'s Sales by Channel report in the UI is the fallback.',
    promoProbe: promoKeys.size
      ? `read from field(s) ${[...promoKeys].join(', ')} (ticket first, then order).`
      : 'no promo or offer field found on tickets or orders in this scan; promo columns are blank.',
    comparisonReasons: COMPARISON_REASONS(shows),
  };

  await mkdir(OUT, { recursive: true });
  const xlsx = path.join(OUT, 'the-father-spektrix-baseline.xlsx');
  const md = path.join(OUT, 'data_notes.md');
  await writeWorkbook(snapshot, xlsx);
  await writeFile(md, renderNotes(snapshot));
  await writeFile(path.join(OUT, 'father-report-snapshot.json'), JSON.stringify({ ...snapshot, shows: shows.map(s => ({ ...s, buyers: undefined })) }, null, 1));
  console.log(`wrote ${xlsx}`);
  console.log(`wrote ${md}`);
  for (const s of shows) console.log(`  ${s.short.padEnd(13)} instances ${String(s.instances.length).padStart(3)}  single ${String(s.pacing.totals.single).padStart(5)}  sub ${String(s.pacing.totals.sub).padStart(5)}  comp ${String(s.pacing.totals.comp).padStart(4)}  on sale ${s.pacing.onSale || '?'}`);
  if (notes.incomplete.length) console.log(`${notes.incomplete.length} incomplete-data notes recorded; see data_notes.md`);
}

function COMPARISON_REASONS(shows) {
  const found = new Map(shows.map(s => [s.requestedName.toLowerCase(), s]));
  const why = {
    'misery': 'named in the brief; most recent SLO Rep production (Oct 2024).',
    "who's afraid of virginia woolf": 'named in the brief; most recent SLO Rep production (Mar 2026).',
    'the cake': 'lesser-known straight play, 24-25 season (Mar 2025), same 1,512-seat run capacity as The Father.',
    'what the constitution means to me': 'lesser-known straight play, 23-24 season (Mar 2024), lowest final sales of the recent dramas so a floor for the baseline.',
    'stones in his pockets': 'lesser-known two-hander straight play in the same mid-August slot, 23-24 season (Aug 2023). Categorised comedy in the season data; included for the slot match.',
  };
  return COMPARISON.map(name => {
    const s = found.get(name.toLowerCase());
    return `${name}: ${why[name.toLowerCase()] || 'requested on the command line.'} ${s ? `Resolved to "${s.name}".` : 'NOT FOUND in Spektrix; omitted.'}`;
  });
}

main().catch(err => { console.error(err); process.exit(1); });
