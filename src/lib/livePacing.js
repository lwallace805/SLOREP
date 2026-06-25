/**
 * Core live-pacing logic, shared between the API route and the server-side
 * page pre-fetch. Calling this directly avoids an HTTP round-trip.
 */
import crypto from 'crypto';
import { getEvents, getCurrentSold } from './spektrix';

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

// Removed countOrderTickets — replaced by getCurrentSold (availability endpoint, no timeout risk)

// Comp ticket type IDs from Spektrix
const COMP_TYPE_IDS = new Set([
  '601APNNMRMBJQQPBSCNQMHHCNMQSBHBBJ', // Artist Comp
  '801ARDQDDMGGJKKRTNTJBMCCMMBCPQKCR', // Sponsor Comps
  '1001ADGKSHLJDTDBJQTBMGLLJRLBJCMNN', // Volunteer Comp
  '1002AHCBPDSTCNNKTDJHKPNMKHJVQKHSQ', // General Comp
]);
const GROUP_TYPE_IDS = new Set([
  '2201AVBSMNJRLVSBVJRS', // Group
]);

/**
 * Compute ticket mix (single / subscription / group / comp) for one event.
 * Queries orders month-by-month in batches of 4.
 * Returns { single, subscription, group, comp, total } or null on failure.
 */
export async function getTicketMix(eventId, saleStartDate) {
  const today = getPacificDateString();
  const [sy, sm] = saleStartDate.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);

  const months = [];
  let cy = sy, cm = sm;
  while (cy < ty || (cy === ty && cm <= tm)) {
    const last = new Date(cy, cm, 0).getDate();
    months.push({
      from: `${cy}-${String(cm).padStart(2, '0')}-01`,
      to: `${cy}-${String(cm).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    });
    cm++; if (cm > 12) { cm = 1; cy++; }
  }

  const base = `https://system.spektrix.com/${process.env.SPEKTRIX_CLIENT_NAME}/api/v3`;
  const counts = { single: 0, subscription: 0, group: 0, comp: 0 };

  const BATCH = 4;
  for (let i = 0; i < months.length; i += BATCH) {
    await Promise.all(months.slice(i, i + BATCH).map(async ({ from, to }) => {
      let page = 1;
      while (true) {
        const url = `${base}/orders?DateFrom=${from}&DateTo=${to}&page=${page}&pageSize=200`;
        const res = await fetch(url, { headers: spektrixSign('GET', url) });
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) break;
        const orders = await res.json();
        if (!Array.isArray(orders) || orders.length === 0) break;
        for (const order of orders) {
          const hasSub = (order.ticketSubscriptions || []).length > 0;
          for (const t of order.tickets || []) {
            if (t.event?.id !== eventId) continue;
            const typeId = t.type?.id || t.ticketType?.id || '';
            if (COMP_TYPE_IDS.has(typeId) || t.originalPrice === 0) counts.comp++;
            else if (GROUP_TYPE_IDS.has(typeId)) counts.group++;
            else if (hasSub) counts.subscription++;
            else counts.single++;
          }
        }
        if (orders.length < 200) break;
        page++;
      }
    }));
  }

  const total = counts.single + counts.subscription + counts.group + counts.comp;
  if (!total) return null;

  const pct = (n) => Math.round(n / total * 1000) / 10;
  return {
    total,
    buckets: [
      { label: 'Single ticket', count: counts.single,       pct: pct(counts.single),       color: '#0F766E' },
      { label: 'Subscriber',    count: counts.subscription, pct: pct(counts.subscription), color: '#D97706' },
      { label: 'Group',         count: counts.group,        pct: pct(counts.group),        color: '#475569' },
      { label: 'Comp',          count: counts.comp,         pct: pct(counts.comp),         color: '#BBB1A0' },
    ],
  };
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

  // Fetch in batches of 4 months at a time to avoid overwhelming Spektrix API.
  // All 25+ months in parallel causes rate-limiting / timeouts.
  const BATCH = 4;
  for (let i = 0; i < months.length; i += BATCH) {
    await Promise.all(months.slice(i, i + BATCH).map(async ({ from, to }) => {
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
  }

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

      const [oy, om, od] = show.open.split('-').map(Number);
      const openUtcMs = Date.UTC(oy, om - 1, od);

      // Use availability endpoint — instant, no order iteration, no timeout
      const totalSold = await getCurrentSold(event.id);

      const d = Math.round((pacificDateToUtcMs(today) - openUtcMs) / 86400000);
      result[show.name] = { d, c: totalSold };
    } catch {
      // show falls back to static data
    }
  }));

  return result;
}
