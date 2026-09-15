#!/usr/bin/env node
/**
 * Synthetic Spektrix v3 payloads for an offline run of father-report.mjs.
 *
 *   node scripts/father-report-fixture.mjs > /tmp/fixture.json
 *   node scripts/father-report.mjs --fixture /tmp/fixture.json --out /tmp/father-out
 *
 * Shapes mirror what the dashboard code has observed on the live API (order
 * firstTransactionDate, ticket.event.id, ticket.instance.id, ticket.type,
 * originalPrice, order.ticketSubscriptions) plus plausible channel and promo
 * fields so the probes have something to find. Numbers are deterministic
 * (seeded) and carry no meaning beyond exercising every branch.
 */

let seed = 20260915;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const COMP_TYPE = { id: '1002AHCBPDSTCNNKTDJHKPNMKHJVQKHSQ', name: 'General Comp' };
const TYPES = [
  { id: 'T-ADULT', name: 'Adult' }, { id: 'T-SENIOR', name: 'Senior' }, { id: 'T-STUDENT', name: 'Student' },
];

// Catalogue across four seasons. Target shows carry instances; others are just
// names so the catalogue listing and prior-visit dating have something to use.
const EVENTS = [
  ['EV-STONES', 'Stones in His Pockets', '2023-08-11', 14],
  ['EV-NUNS', 'Nunsense', '2023-09-15', 24],
  ['EV-XMAS23', 'A Christmas Story 2023', '2023-11-17', 30],
  ['EV-CONST', 'What the Constitution Means to Me', '2024-03-29', 14],
  ['EV-9TO5', '9 to 5', '2024-06-07', 22],
  ['EV-MISERY', 'Misery', '2024-10-11', 14],
  ['EV-CAKE', 'The Cake', '2025-03-28', 14],
  ['EV-HAMLET', 'I Hate Hamlet', '2025-05-02', 14],
  ['EV-ILY', "I Love You, You're Perfect, Now Change", '2025-08-22', 24],
  ['EV-WOOLF', "Who's Afraid of Virginia Woolf", '2026-03-27', 14],
  ['EV-LIFESPAN', 'The Lifespan of a Fact', '2026-05-01', 14],
  ['EV-NEMO', 'Finding Nemo', '2026-07-10', 12],
  ['EV-FATHER', 'The Father: A Tragic Farce', '2026-08-28', 12],
  ['EV-GUTENBERG', 'Gutenberg! The Musical!', '2026-10-09', 24],
];

// Thu/Fri/Sat 7pm, Sat/Sun 2pm pattern from an opening Friday.
function instancesFor(eventId, open, count) {
  const out = [];
  const pattern = [[0, '19:00'], [1, '14:00'], [1, '19:00'], [2, '14:00'], [6, '19:00'], [7, '19:00'], [8, '14:00'], [8, '19:00'], [9, '14:00'], [13, '19:00'], [14, '19:00'], [15, '14:00'], [15, '19:00'], [16, '14:00']];
  for (let i = 0; i < count && i < pattern.length; i++) {
    const [off, time] = pattern[i];
    out.push({ id: `${eventId}-I${i + 1}`, start: `${addDays(open, off)}T${time}:00`, capacity: 108 });
  }
  return out;
}

const events = [], availability = {}, instances = {}, orders = [], customers = {};
const instanceIndex = {};
for (const [id, name, open, count] of EVENTS) {
  const inst = instancesFor(id, open, count);
  events.push({ id, name, firstInstanceDateTime: inst[0].start, lastInstanceDateTime: inst.at(-1).start, instanceCount: inst.length });
  instances[id] = inst.map(i => ({ id: i.id, dt: i.start.slice(0, 16).replace('T', ' '), capacity: i.capacity, cancelled: false }));
  instanceIndex[id] = inst;
}

// Customer pool: 400 people, some long-standing, some new. Postcodes lean 93xxx.
const CUSTOMER_IDS = Array.from({ length: 400 }, (_, i) => `C${1000 + i}`);
for (const id of CUSTOMER_IDS) {
  customers[id] = {
    id, firstName: 'REDACT', lastName: 'REDACT', email: 'redact@example.com',
    addresses: [{ postcode: rnd() < 0.75 ? `93${String(400 + Math.floor(rnd() * 60)).padStart(3, '0')}` : `9${Math.floor(rnd() * 9)}${String(Math.floor(rnd() * 999)).padStart(3, '0')}` }],
    dateOfBirth: rnd() < 0.6 ? `${1940 + Math.floor(rnd() * 60)}-06-01T00:00:00` : null,
    attribute_Source: pick(['', 'Website', 'Friend']),
  };
}
const subscribers = new Set(CUSTOMER_IDS.slice(0, 80));

let orderSeq = 1;
function addOrder({ customerId, date, items, channel, promo, sub }) {
  const tickets = [];
  for (const it of items) {
    const price = it.comp ? 0 : it.priceOverride ?? (promo === 'THURS15' ? 30 : pick([32, 36, 42]));
    tickets.push({
      id: `TK${orderSeq}-${tickets.length}`,
      event: { id: it.eventId }, instance: { id: it.instanceId },
      type: it.comp ? COMP_TYPE : pick(TYPES),
      band: { id: 'B1', name: 'Standard' },
      originalPrice: it.comp ? 0 : 42, price, seat: { name: `A${tickets.length + 1}` },
      ...(promo ? { promotion: { id: 'P1', name: promo } } : {}),
    });
  }
  orders.push({
    id: `O${orderSeq++}`, customer: { id: customerId },
    firstTransactionDate: `${date}T10:30:00`, lastTransactionDate: `${date}T10:31:00`,
    total: tickets.reduce((s, t) => s + t.price, 0),
    salesChannel: channel,
    tickets,
    ticketSubscriptions: sub ? [{ id: `S${orderSeq}`, name: 'Season Subscription' }] : [],
    donations: [], merchandise: [],
  });
}

// Sales per show: subscription allocations in a June burst, singles ramping
// toward opening and through the run, a handful of comps near opening.
function sellShow(eventId, open, { singles, subs, comps, promoDates = [] }) {
  const inst = instanceIndex[eventId];
  const onSale = addDays(open, -110);
  const subDay = addDays(open, -80);
  for (let i = 0; i < subs; i++) {
    const cust = pick([...subscribers]);
    const perf = pick(inst);
    addOrder({ customerId: cust, date: addDays(subDay, Math.floor(rnd() * 6)), channel: pick(['Box Office', 'Web']), sub: true,
      items: [{ eventId, instanceId: perf.id }, { eventId, instanceId: perf.id }] });
  }
  for (let i = 0; i < singles; i++) {
    // Skewed toward opening: square the uniform draw.
    const u = rnd(); const dayOffset = Math.floor((1 - u * u) * 120) - 110;
    const date = addDays(open, Math.min(dayOffset, 16));
    const eligible = inst.filter(x => x.start.slice(0, 10) >= date);
    if (!eligible.length) continue;
    const perf = pick(eligible);
    const n = rnd() < 0.55 ? 2 : rnd() < 0.7 ? 1 : 3 + Math.floor(rnd() * 3);
    const perfDate = perf.start.slice(0, 10);
    const promo = promoDates.includes(perfDate) && rnd() < 0.4 ? 'THURS15' : rnd() < 0.03 ? 'MAIL' : '';
    addOrder({ customerId: pick(CUSTOMER_IDS), date, channel: pick(['Web', 'Web', 'Web', 'Phone', 'Box Office']), promo,
      items: Array.from({ length: n }, () => ({ eventId, instanceId: perf.id })) });
  }
  for (let i = 0; i < comps; i++) {
    const perf = pick(inst);
    addOrder({ customerId: pick(CUSTOMER_IDS), date: addDays(open, -3 + Math.floor(rnd() * 10)), channel: 'Box Office',
      items: [{ eventId, instanceId: perf.id, comp: true }, { eventId, instanceId: perf.id, comp: true }] });
  }
}

sellShow('EV-STONES', '2023-08-11', { singles: 140, subs: 60, comps: 12 });
sellShow('EV-NUNS', '2023-09-15', { singles: 300, subs: 70, comps: 10 });
sellShow('EV-XMAS23', '2023-11-17', { singles: 500, subs: 70, comps: 10 });
sellShow('EV-CONST', '2024-03-29', { singles: 180, subs: 60, comps: 10 });
sellShow('EV-9TO5', '2024-06-07', { singles: 350, subs: 70, comps: 10 });
sellShow('EV-MISERY', '2024-10-11', { singles: 320, subs: 70, comps: 12 });
sellShow('EV-CAKE', '2025-03-28', { singles: 280, subs: 65, comps: 12 });
sellShow('EV-HAMLET', '2025-05-02', { singles: 300, subs: 65, comps: 10 });
sellShow('EV-ILY', '2025-08-22', { singles: 500, subs: 70, comps: 10 });
sellShow('EV-WOOLF', '2026-03-27', { singles: 380, subs: 70, comps: 14 });
sellShow('EV-LIFESPAN', '2026-05-01', { singles: 360, subs: 70, comps: 10 });
sellShow('EV-NEMO', '2026-07-10', { singles: 300, subs: 40, comps: 10 });
sellShow('EV-FATHER', '2026-08-28', { singles: 260, subs: 70, comps: 14, promoDates: ['2026-09-03', '2026-09-10'] });

// Availability mirrors the orders: sold = every ticket (comps included), as the
// seat-status endpoint would report it.
for (const [id] of EVENTS) {
  const sold = {};
  for (const o of orders) for (const t of o.tickets) if (t.event.id === id) sold[t.instance.id] = (sold[t.instance.id] || 0) + 1;
  availability[id] = instanceIndex[id].map(i => ({ id: i.id, dt: i.start.slice(0, 16).replace('T', ' '), sold: sold[i.id] || 0, cap: i.capacity, pct: Math.round(((sold[i.id] || 0) / i.capacity) * 1000) / 10 }));
}

process.stdout.write(JSON.stringify({ events, availability, instances, orders, customers }));
