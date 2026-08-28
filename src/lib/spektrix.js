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
    .replace(/[^a-z0-9 ]+/g, ' ')          // punctuation to space
    .replace(/\b(the|a|an)\b/g, ' ')       // leading articles carry no signal
    .replace(/\b(jr|junior|the musical|a musical)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Get the current total net sold tickets for an event (sum across all instances).
 */
export async function getCurrentSold(eventId) {
  const instances = await getInstanceAvailability(eventId);
  return instances.reduce((s, i) => s + i.sold, 0);
}
