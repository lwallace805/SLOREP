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
      // Availability API counts. These are unreliable for PAST performances —
      // Spektrix resets seat statuses after a performance date passes, so the
      // "sold" figure here drops to near-zero even for a full house.
      // The instances route overrides these with orders-based counts for accuracy.
      const sold = avail
        .filter((a) => a.status === 'Sold')
        .reduce((s, a) => s + a.count, 0);
      const cap = inst.capacity || 0;
      const dt = inst.start ? inst.start.slice(0, 16).replace('T', ' ') : '';
      // Pass id through so callers can match against orders-based per-instance counts
      return { id: inst.id, dt, sold, cap, pct: cap > 0 ? Math.round((sold / cap) * 1000) / 10 : 0 };
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
