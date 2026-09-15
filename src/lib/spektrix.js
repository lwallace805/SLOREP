import crypto from 'crypto';

const BASE = () =>
  `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;

function headers(method, url) {
  const date = new Date().toUTCString();
  const sig = crypto
    .createHmac('sha1', Buffer.from(process.env.SPEKTRIX_API_KEY, 'base64'))
    .update(`${method}\n${url}\n${date}`)
    .digest('base64');
  return {
    Authorization: `SpektrixAPI3 ${process.env.SPEKTRIX_API_USER}:${sig}`,
    Date: date,
  };
}

/** Fetch all pages of a Spektrix endpoint, returning a flat array. */
export async function spektrixGetAll(path, pageSize = 200) {
  const base = BASE();
  const results = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${base}${path}${sep}page=${page}&pageSize=${pageSize}`;
    const res = await fetch(url, { headers: headers('GET', url) });
    if (!res.ok) throw new Error(`Spektrix ${res.status}: ${path} page ${page}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    page++;
  }
  return results;
}

/** Fetch a single Spektrix endpoint (no pagination). */
export async function spektrixGet(path) {
  const url = `${BASE()}${path}`;
  const res = await fetch(url, { headers: headers('GET', url) });
  if (!res.ok) throw new Error(`Spektrix ${res.status}: ${path}`);
  return res.json();
}

/**
 * Get all events with their current availability.
 * Returns [{id, name, firstInstanceDateTime, lastInstanceDateTime}]
 */
export async function getEvents() {
  return spektrixGetAll('/events');
}

/**
 * Events that were running around a date, for a closed show the bare listing
 * no longer carries (it holds only events with performances still to come, and
 * the instances listing behaves the same way). Orders placed in the week
 * around opening night carry the event id on every ticket, so the events are
 * read off those and then fetched one by one. `debug` collects how each
 * lookup fared so the route can say why a show was not found.
 */
export async function getEventsAround(dateStr, debug = null, before = 3, after = 10) {
  if (!dateStr) return [];
  const shift = (n) => new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const from = shift(-before), to = shift(after);
  const ids = new Set();
  // The events listing, in case a date filter reaches into the past after all.
  for (const q of [`instanceStart_from=${from}&instanceStart_to=${to}`, `start_from=${from}&start_to=${to}`]) {
    try {
      const evs = await spektrixGetAll(`/events?${q}`);
      if (debug) debug[q] = evs.length;
      for (const e of evs) if (e?.id) ids.add(e.id);
    } catch (err) { if (debug) debug[q] = `error: ${err.message}`; }
  }
  try {
    const orders = await spektrixGet(`/orders?DateFrom=${from}&DateTo=${to}&page=1&pageSize=200`);
    if (debug) debug.ordersSampled = Array.isArray(orders) ? orders.length : 'not an array';
    for (const o of Array.isArray(orders) ? orders : []) {
      for (const t of o?.tickets || []) {
        const id = typeof t?.event === 'string' ? t.event : t?.event?.id;
        if (id) ids.add(id);
      }
    }
  } catch (err) { if (debug) debug.orders = `error: ${err.message}`; }
  const events = await Promise.all([...ids].map(id => spektrixGet(`/events/${id}`).catch(() => null)));
  const found = events.filter(e => e && e.id);
  if (debug) debug.eventsFound = found.map(e => e.name);
  return found;
}

/**
 * Season-data show names and Spektrix event names do not always agree — the
 * season file says "Finding Nemo" where Spektrix may carry a fuller billing
 * title. An exact-only match silently drops those shows: they simply never get
 * live data, and the dashboard shows their frozen export figure instead, with
 * nothing to indicate anything failed.
 *
 * Exact match wins. Otherwise fall back to a normalised comparison, and accept
 * a prefix or substring hit only when exactly one event matches, so a loose
 * name can never bind to the wrong production.
 */
function normaliseTitle(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')                        // punctuation to space
    .replace(/\b(the musical|a musical|jr|junior)\b/g, ' ') // billing suffixes
    .replace(/\s+/g, ' ')
    .trim()
    // Leading article only. Stripping "a"/"the" anywhere collapses distinct
    // titles — "Nemo A" became "nemo" and matched a bare "Nemo".
    .replace(/^(the|a|an) /, '');
}

export function findEvent(events, showName) {
  if (!showName) return null;
  const wanted = showName.toLowerCase();
  const exact = (events || []).find(e => e.name?.toLowerCase() === wanted);
  if (exact) return exact;

  const target = normaliseTitle(showName);
  if (!target) return null;
  const named = (events || []).filter(e => e.name);

  const normEqual = named.filter(e => normaliseTitle(e.name) === target);
  if (normEqual.length === 1) return normEqual[0];

  const partial = named.filter(e => {
    const n = normaliseTitle(e.name);
    return n.startsWith(target) || target.startsWith(n) || n.includes(target);
  });
  return partial.length === 1 ? partial[0] : null;
}

/**
 * Get per-instance availability for an event.
 * Returns [{dt, sold, cap, pct}] sorted by dt asc.
 *
 * Spektrix wraps the response in {data: [...]} — we unwrap it here.
 */
export async function getInstanceAvailability(eventId) {
  const raw = await spektrixGet(
    `/events/${eventId}/availability?start_from=2015-01-01&start_to=2030-12-31`
  );

  // Unwrap {data: [...]} wrapper if present, otherwise expect a plain array
  const data = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);

  if (!data.length) return [];

  return data
    .map((inst) => {
      const avail = inst.availability || [];
      // Count committed seats: 'Sold' (pre-purchased, upcoming or no-show) +
      // 'Scanned' (ticket scanned at the door — the patron attended).
      // Once a patron enters, Spektrix moves their ticket from Sold → Scanned,
      // so past performances show almost everything under Scanned.
      // Counting only 'Sold' gives ~10% fill even for a packed house.
      // 'Available' = seats that were never purchased; we exclude those.
      const sold = avail
        .filter((a) => a.status === 'Sold' || a.status === 'Scanned')
        .reduce((s, a) => s + a.count, 0);
      const cap = inst.capacity || 0;
      const dt = inst.start ? inst.start.slice(0, 16).replace('T', ' ') : '';
      // Availability endpoint uses 'eventInstanceId', not 'id'
      return { id: inst.eventInstanceId, dt, sold, cap, pct: cap > 0 ? Math.round((sold / cap) * 1000) / 10 : 0 };
    })
    .filter((i) => i.dt)
    .sort((a, b) => a.dt.localeCompare(b.dt));
}

/**
 * A past event's performances, for when the availability endpoint has nothing
 * to say about them any more. Returns [{ id, dt, capacity, sold }] with
 * capacity and sold filled where /instances/{id}/status still answers.
 */
export async function getPastInstances(eventId) {
  let raw;
  try { raw = await spektrixGet(`/events/${eventId}/instances`); } catch { return { instances: [], note: 'events/{id}/instances failed' }; }
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  const instances = await Promise.all(list.map(async (inst) => {
    const id = inst?.id || inst?.eventInstanceId;
    const dt = inst?.start ? inst.start.slice(0, 16).replace('T', ' ') : '';
    let status = null;
    try { status = await spektrixGet(`/instances/${id}/status`); } catch { status = null; }
    // Numbers only from the status: seat counts by state, never customer data.
    const nums = {};
    for (const [k, v] of Object.entries(status || {})) if (typeof v === 'number') nums[k] = v;
    return {
      id, dt,
      cancelled: inst?.cancelled ?? null,
      planId: inst?.planId ?? null,
      capacity: status?.capacity ?? null,
      sold: (status?.sold ?? 0) + (status?.scanned ?? 0),
      status: nums,
    };
  }));
  const sorted = instances.filter(i => i.dt).sort((a, b) => a.dt.localeCompare(b.dt));
  // Seat count of the plan the run used, from the first performance's plan.
  // Counts only, never seat-holder data.
  let plan = null;
  if (sorted.length) {
    for (const path of [`/instances/${sorted[0].id}/plan`, `/plans/${sorted[0].planId}`]) {
      try {
        const raw = await spektrixGet(path);
        const seats = Array.isArray(raw?.seats) ? raw.seats.length : null;
        const areas = Array.isArray(raw?.areas) ? raw.areas.map(a => ({ name: a?.name, seats: Array.isArray(a?.seats) ? a.seats.length : null, capacity: a?.capacity ?? null })) : null;
        plan = { path, keys: Object.keys(raw || {}).slice(0, 30), seats, areas, capacity: raw?.capacity ?? null };
        break;
      } catch (err) { plan = { path, error: err.message }; }
    }
  }
  return { instances: sorted, plan };
}

/**
 * Get the current total net sold tickets for an event (sum across all instances).
 */
export async function getCurrentSold(eventId) {
  const instances = await getInstanceAvailability(eventId);
  return instances.reduce((s, i) => s + i.sold, 0);
}
