/**
 * Rebuild src/data/pacingData.js from the order scan, on one stated basis.
 *
 *   node scripts/rebuild-pacing-data.mjs [--base <url>] [--show <name>]... [--dry] [--net-paid]
 *
 * The data file was committed from a Spektrix export whose counting rule was
 * never recorded. Audited against the scan it lands above some finals and
 * below others, its capacities assume 108 seats times a guessed performance
 * count, and its `p` column is percent-of-final for the older seasons and
 * percent-of-capacity from 25-26 on, while the projection reads it as
 * percent-of-final throughout. This regenerates every show the same way:
 *
 *   series  one point per day with sales, cumulative tickets from the show's
 *           first order to its closing night (or today, for a show still on
 *           sale), all seats (comps included) unless --net-paid
 *   final   the last cumulative for a closed show; null while still on sale
 *   cap     performances times seats on the plan, from Spektrix, falling back
 *           to the existing value when Spektrix no longer lists the run
 *   p       cumulative as a percent of final (of the live count, for a show
 *           still on sale), which is what the projection maths expects
 *
 * name, cat, season and open are kept. Each show is one to four requests to
 * the deployed history-fill route, walked in 120-day legs, and one to the
 * instances route, run one show at a time so Spektrix is not swamped.
 */
import fs from 'fs';
import { DATA } from '../src/data/pacingData.js';
import { addDays, daysBetween } from '../src/lib/historyFill.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = (opt('--base', 'https://slorep-sales-dashboard.vercel.app')).replace(/\/$/, '');
const BYPASS = opt('--bypass', null);
const DRY = args.includes('--dry');
const NET_PAID = args.includes('--net-paid');
const ONLY = args.flatMap((a, i) => (a === '--show' ? [args[i + 1]] : []));
const TODAY = opt('--today', new Date().toISOString().slice(0, 10));
const OUT = opt('--out', 'src/data/pacingData.js');
const MAX_LEGS = 8;

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {} });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(`${path}: ${res.status} ${body?.error || ''}`);
  return body;
}

/** Closing date: Spektrix's last performance when it lists the run, else the
 *  baked series' last point when that is past opening, else today. */
async function runWindow(show) {
  const first = show.series[0];
  const last = show.series[show.series.length - 1];
  let cap = show.cap, close = null, source = 'file';
  try {
    const inst = await getJson(`/api/instances?name=${encodeURIComponent(show.name)}&open=${show.open}`);
    if (inst.instances?.length) {
      cap = inst.instances.reduce((s, i) => s + (i.cap || 0), 0);
      close = inst.instances[inst.instances.length - 1].dt.slice(0, 10);
      source = 'availability';
    } else if (inst.past?.instances?.length) {
      const seats = (inst.past.plan?.areas || []).reduce((s, a) => s + (a.capacity ?? a.seats ?? 0), 0);
      const live = inst.past.instances.filter(i => !i.cancelled);
      if (seats) cap = live.length * seats;
      close = live[live.length - 1].dt.slice(0, 10);
      source = seats ? 'plan' : 'file (plan unreadable)';
    }
  } catch (err) {
    source = `file (${err.message})`;
  }
  if (!close) close = last.d > 0 ? addDays(show.open, last.d) : null;
  const closed = close != null && close < TODAY;
  return { from: addDays(show.open, first.d), to: closed ? close : TODAY, closed, cap, capSource: source };
}

async function walk(show, from, to) {
  const legs = [];
  let baseline = 0;
  for (let leg = 0; leg < MAX_LEGS && from <= to; leg++) {
    const params = new URLSearchParams({
      name: show.name, fromDate: from, toDate: to, baselineCount: String(baseline),
      openDate: show.open, comps: NET_PAID ? '0' : '1',
    });
    const r = await getJson(`/api/history-fill?${params}`);
    legs.push(r);
    baseline = r.total;
    if (!r.truncated || r.scanTo >= to) break;
    from = addDays(r.scanTo, 1);
  }
  return legs;
}

const rebuilt = [];
const summary = [];
for (const show of DATA) {
  if (ONLY.length && !ONLY.includes(show.name)) { rebuilt.push(show); continue; }
  if (!show.series?.length) { rebuilt.push(show); continue; }
  process.stderr.write(`${show.name}: `);
  let entry, note;
  try {
    const win = await runWindow(show);
    const legs = await walk(show, win.from, win.to);
    const byD = new Map();
    for (const l of legs) for (const pt of l.series) byD.set(pt.d, pt.c);
    const pts = [...byD.entries()].sort((a, b) => a[0] - b[0]).map(([d, c]) => ({ d, c }));
    // Drop the route's flat closing stamp when nothing sold that day, but
    // always keep the first point so the curve has a start.
    const series = pts.filter((p, i) => i === 0 || p.c !== pts[i - 1].c);
    const total = pts.length ? pts[pts.length - 1].c : 0;
    const final = win.closed ? total : null;
    const denom = total || 1;
    for (const p of series) p.p = Math.round(p.c / denom * 1000) / 10;
    const complete = legs.every(l => l.complete);
    const problems = legs.flatMap(l => l.incompleteWindows || []);
    entry = { name: show.name, cat: show.cat, season: show.season, open: show.open, cap: win.cap, final, inProgress: false, series };
    note = { name: show.name, closed: win.closed, scan: `${win.from}..${win.to}`, legs: legs.length, complete, problems,
      oldCap: show.cap, newCap: win.cap, capSource: win.capSource, oldFinal: show.final, newFinal: final, total };
    process.stderr.write(`${win.from}..${win.to} ${legs.length} leg(s) total ${total} cap ${win.cap} (${win.capSource})${complete ? '' : ' INCOMPLETE ' + JSON.stringify(problems)}\n`);
  } catch (err) {
    entry = show;
    note = { name: show.name, error: err.message, oldFinal: show.final, oldCap: show.cap };
    process.stderr.write(`kept as is: ${err.message}\n`);
  }
  rebuilt.push(entry);
  summary.push(note);
}

const lines = ['| Show | Scan | Complete | Cap (was) | Final (was) |', '|---|---|---|---|---|'];
for (const n of summary) {
  lines.push(n.error
    ? `| ${n.name} | kept: ${n.error} | | ${n.oldCap} | ${n.oldFinal ?? ''} |`
    : `| ${n.name} | ${n.scan} | ${n.complete ? 'yes' : 'NO ' + n.problems.join('; ')} | ${n.newCap} (${n.oldCap}, ${n.capSource}) | ${n.newFinal ?? 'on sale: ' + n.total} (${n.oldFinal ?? ''}) |`);
}
console.log(lines.join('\n'));
if (!DRY) {
  fs.writeFileSync(OUT, `export const DATA = ${JSON.stringify(rebuilt)};\n`);
  fs.mkdirSync('report', { recursive: true });
  fs.writeFileSync('report/pacing-data-rebuild.md', `# pacingData.js rebuild, ${TODAY}\n\nBasis: ${NET_PAID ? 'net paid' : 'all seats (comps included)'}. Source: ${BASE}.\n\n${lines.join('\n')}\n`);
  console.error(`\nwrote ${OUT} and report/pacing-data-rebuild.md`);
}
