// Walk the production revenue-scan month by month and aggregate per event.
import fs from 'fs';
const BASE = process.env.BASE || 'https://slorep-sales-dashboard.vercel.app';
const FROM = process.env.FROM || '2024-05-19';
const TO = process.env.TO || new Date().toISOString().slice(0, 10);
const OUT = process.env.OUT || 'out';
fs.mkdirSync(OUT, { recursive: true });

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function monthRanges(from, to) {
  const out = []; let cur = from;
  while (cur <= to) {
    const [y, m] = cur.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ from: cur, to: last > to ? to : last, month: cur.slice(0, 7) });
    cur = addDays(last, 1);
  }
  return out;
}
async function getJson(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(`${res.status} ${body.error || ''}`);
      return body;
    } catch (e) {
      console.error(`  try ${i} failed: ${e.message}`);
      if (i === tries) throw e;
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  }
}

const raw = {}; // month -> scan
for (const r of monthRanges(FROM, TO)) {
  let scan = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    scan = await getJson(`${BASE}/api/revenue-scan?from=${r.from}&to=${r.to}`);
    console.log(`${r.from}..${r.to}: orders ${scan.orders} tickets ${scan.tickets} complete ${scan.complete} ms ${scan.ms}${scan.incomplete?.length ? ' ' + JSON.stringify(scan.incomplete) : ''}`);
    if (scan.complete) break;
  }
  raw[r.month] = scan;
}
fs.writeFileSync(`${OUT}/raw.json`, JSON.stringify(raw));

// Resolve names.
const eventIds = [...new Set(Object.values(raw).flatMap(s => Object.keys(s.agg || {})))];
const meta = { events: [], ticketTypes: [] };
for (let i = 0; i < eventIds.length; i += 30) {
  const m = await getJson(`${BASE}/api/revenue-scan?meta=1&events=${eventIds.slice(i, i + 30).join(',')}`);
  meta.events.push(...(m.events || []));
  if (Array.isArray(m.ticketTypes)) meta.ticketTypes = m.ticketTypes;
}
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
const typeName = Object.fromEntries(meta.ticketTypes.map(t => [t.id, t.name]));
const evMeta = Object.fromEntries(meta.events.map(e => [e.id, e]));
const cls = (typeId, face) => {
  const n = (typeName[typeId] || '').toLowerCase();
  if (face === 0 || n.includes('comp')) return 'comp';
  if (n.includes('group')) return 'grp';
  if (n.includes('student')) return 'stu';
  if (n.includes('senior')) return 'sen';
  return 'adu';
};

const events = {};
const subsByMonth = {};
for (const [month, scan] of Object.entries(raw)) {
  subsByMonth[month] = scan.subscriptions || {};
  for (const [eid, keys] of Object.entries(scan.agg || {})) {
    const e = events[eid] || (events[eid] = {
      id: eid, name: evMeta[eid]?.name ?? null, first: evMeta[eid]?.perfs?.first ?? evMeta[eid]?.first ?? null,
      last: evMeta[eid]?.perfs?.last ?? evMeta[eid]?.last ?? null, perfs: evMeta[eid]?.perfs?.count ?? null,
      t: 0, comp: 0, paid: 0, sub: 0, single: 0, adu: 0, sen: 0, stu: 0, grp: 0, rev: 0, disc: 0, discounted: 0,
      offers: {}, byMonth: {},
    });
    const bm = e.byMonth[month] || (e.byMonth[month] = { t: 0, paid: 0, sub: 0, single: 0, comp: 0, rev: 0, promo: 0 });
    for (const [key, [n, disc, total]] of Object.entries(keys)) {
      const [typeId, sub, faceS, priceS, offer] = key.split('|');
      const face = +faceS, price = +priceS;
      const c = cls(typeId, face);
      e.t += n; bm.t += n;
      if (c === 'comp' || price === 0) { e.comp += n; bm.comp += n; continue; }
      e.paid += n; bm.paid += n; e.rev += total; bm.rev += total; e.disc += disc;
      if (price < face) e.discounted += n;
      if (sub === '1') { e.sub += n; bm.sub += n; } else { e.single += n; bm.single += n; }
      e[c] += n;
      if (offer) {
        const o = e.offers[offer] || (e.offers[offer] = { t: 0, disc: 0, rev: 0, face: 0, byMonth: {}, types: {} });
        o.t += n; o.disc += disc; o.rev += total; o.face += face * n;
        o.byMonth[month] = (o.byMonth[month] || 0) + n;
        o.types[typeName[typeId] || typeId] = (o.types[typeName[typeId] || typeId] || 0) + n;
        bm.promo += n;
      }
    }
  }
}
const $ = c => Math.round(c / 100);
for (const e of Object.values(events)) {
  e.rev = $(e.rev); e.disc = $(e.disc);
  for (const o of Object.values(e.offers)) { o.disc = $(o.disc); o.rev = $(o.rev); o.face = $(o.face); }
  for (const bm of Object.values(e.byMonth)) bm.rev = $(bm.rev);
}
fs.writeFileSync(`${OUT}/events.json`, JSON.stringify({ from: FROM, to: TO, events, subsByMonth }, null, 1));

const rows = Object.values(events).sort((a, b) => (a.first || '').localeCompare(b.first || ''));
const tsv = [['name', 'first', 'last', 'perfs', 'tickets', 'comp', 'paid', 'sub', 'single', 'adu', 'sen', 'stu', 'grp', 'rev$', 'disc$', 'discounted', 'offers'].join('\t')];
for (const e of rows) tsv.push([e.name, e.first, e.last, e.perfs, e.t, e.comp, e.paid, e.sub, e.single, e.adu, e.sen, e.stu, e.grp, e.rev, e.disc, e.discounted,
  Object.entries(e.offers).map(([id, o]) => `${id.slice(0, 4)}:${o.t}/$${o.disc}`).join(' ')].join('\t'));
fs.writeFileSync(`${OUT}/events.tsv`, tsv.join('\n') + '\n');
console.log(tsv.join('\n'));
