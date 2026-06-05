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
 * Fetch all orders for an event and return per-instance ticket counts.
 * Queries month-by-month to stay within Spektrix's response limits.
 * Returns { [instanceId]: count }
 */
export async function getPerInstanceCounts(eventId, saleStartDate) {
  const today = getPacificDateString();
  const [sy, sm] = saleStartDate.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);

  // Build monthly ranges from sale start to today
  const months = [];
  let cy = sy, cm = sm;
  while (cy < ty || (cy === ty && cm <= tm)) {
    const lastDay = new Date(cy, cm, 0).getDate();
    months.push({
      from: `${cy}-${String(cm).padStart(2,'0')}-01`,
      to:   `${cy}-${String(cm).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`,
    });
    cm++; if (cm > 12) { cm = 1; cy++; }
  }

  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  const counts = {};

  // Fetch months in parallel, each with internal pagination
  await Promise.all(months.map(async ({ from, to }) => {
    let page = 1;
    while (true) {
      const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=${page}&pageSize=200`;
      const res = await fetch(url, { headers: spektrixSign('GET', url) });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) break;
      const orders = await res.json();
      if (!Array.isArray(orders) || orders.length === 0) break;
      for (const order of orders) {
        for (const t of order.tickets || []) {
          if (t.event?.id === eventId) {
            const iid = t.instance?.id;
            if (iid) counts[iid] = (counts[iid] || 0) + 1;
          }
        }
      }
      if (orders.length < 200) break;
      page++;
    }
  }));

  return counts;
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
