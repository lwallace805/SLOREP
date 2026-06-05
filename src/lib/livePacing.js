/**
 * Core live-pacing logic, shared between the API route and the server-side
 * page pre-fetch. Calling this directly avoids an HTTP round-trip.
 */
import crypto from 'crypto';
import { getEvents } from './spektrix';

// SLO Rep is in Pacific Time.
export function getPacificDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function pacificDateToUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function spektrixSign(method, url) {
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

async function countOrderTickets(eventId, fromDate, toDate) {
  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  let page = 1;
  let count = 0;
  while (true) {
    const url = `${base}/orders?DateFrom=${fromDate}&DateTo=${toDate}&page=${page}&pageSize=200`;
    const res = await fetch(url, { headers: spektrixSign('GET', url) });
    if (!res.ok) break;
    if (!(res.headers.get('content-type') || '').includes('json')) break;
    const orders = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) break;
    for (const order of orders) {
      for (const t of order.tickets || []) {
        if (t.event?.id === eventId) count++;
      }
    }
    if (orders.length < 200) break;
    page++;
  }
  return count;
}

/**
 * For each in-progress show in the provided list, fetch the live current count.
 * Returns { [showName]: { d, c } }
 *
 * @param {Array<{name, open, series, inProgress}>} shows - the DATA array (or subset)
 */
export async function getLivePacingData(shows) {
  const inProgress = shows.filter(s => s.inProgress && s.series.length > 0);
  if (!inProgress.length) return {};

  const events = await getEvents();
  const today = getPacificDateString();
  const result = {};

  await Promise.all(inProgress.map(async (show) => {
    try {
      const event = events.find(e => e.name?.toLowerCase() === show.name.toLowerCase());
      if (!event) return;

      const lastPt = show.series[show.series.length - 1];
      const [oy, om, od] = show.open.split('-').map(Number);
      const openUtcMs = Date.UTC(oy, om - 1, od);

      // fromDate = day after last static series point
      const baselineUtcMs = openUtcMs + lastPt.d * 86400000;
      const fromDate = new Date(baselineUtcMs + 86400000).toISOString().slice(0, 10);

      const delta = await countOrderTickets(event.id, fromDate, today);

      const d = Math.round((pacificDateToUtcMs(today) - openUtcMs) / 86400000);
      result[show.name] = { d, c: lastPt.c + delta };
    } catch {
      // show falls back to static data
    }
  }));

  return result;
}
