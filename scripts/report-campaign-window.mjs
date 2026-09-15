/**
 * Campaign-window report from the deployed history-fill route.
 *
 *   node scripts/report-campaign-window.mjs --base https://slorep-sales-dashboard.vercel.app --out report/
 *
 * For each show below, walks history-fill from the show's first export point
 * (or on-sale day) to its closing day in 120-day legs, chaining each leg's
 * total into the next as baselineCount, and writes:
 *   <out>/<slug>.csv            date, days_to_opening, cumulative, daily_added
 *   <out>/campaign-window.md    the window numbers, one section per show
 *
 * Windows are relative to opening: cumulative at day -32 (the day before the
 * first campaign email for The Father, 27 July 2026), tickets added from day
 * -31 through day +16, and the final. Both counting bases are pulled for The
 * Father so the final can be set against the live seat count with and without
 * comps.
 *
 * Options:
 *   --base <url>       deployment to query (default: production)
 *   --out <dir>        output directory (default: report)
 *   --bypass <secret>  Vercel "Protection Bypass for Automation" secret, for a
 *                      protected preview deployment
 *   --show <name>      only this show (repeatable)
 *   --today <date>     scan end for shows still on sale (default: today, UTC)
 */
import fs from 'fs';
import path from 'path';
import { DATA } from '../src/data/pacingData.js';
import { addDays, daysBetween, MAX_SCAN_DAYS } from '../src/lib/historyFill.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = (opt('--base', 'https://slorep-sales-dashboard.vercel.app')).replace(/\/$/, '');
const OUT = opt('--out', 'report');
const BYPASS = opt('--bypass', null);
const TODAY = opt('--today', new Date().toISOString().slice(0, 10));
const ONLY = args.flatMap((a, i) => (a === '--show' ? [args[i + 1]] : []));

// Day -32 / -31..+16 are the campaign windows the report compares.
const DAY_BEFORE_CAMPAIGN = -32;
const CAMPAIGN_FROM = -31;
const CAMPAIGN_TO = 16;

const SHOWS = [
  { name: 'The Father', bases: ['paid', 'comps'] },
  { name: 'Misery' },
  { name: 'The Cake' },
  { name: "Who's Afraid of Virginia Woolf" },
  { name: 'I Hate Hamlet' },
  { name: 'The Lifespan of a Fact' },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function fetchFill(params) {
  const url = `${BASE}/api/history-fill?${new URLSearchParams(params)}`;
  const headers = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(`${url}: ${res.status} ${body?.error || ''}`);
  return body;
}

/**
 * Walk [from, to] in legs the route will accept, chaining totals. For a show
 * still on sale the last leg ends today and the route appends its own point
 * at today; for a closed show every leg is truncated and no such point lands.
 */
async function walk(show, includeComps) {
  const legs = [];
  const first = show.series[0];
  let from = addDays(show.open, first.d);
  let baseline = 0;
  // A baked series that reaches past opening ends on the show's closing point;
  // one that stops short belongs to a show still on sale, so scan to today.
  const last = show.series[show.series.length - 1];
  const closed = last.d > 0;
  const to = closed ? addDays(show.open, last.d) : TODAY;
  while (from <= to) {
    const r = await fetchFill({
      name: show.name, fromDate: from, toDate: to, baselineCount: String(baseline),
      openDate: show.open, comps: includeComps ? '1' : '0',
    });
    legs.push(r);
    process.stderr.write(`  ${show.name} [${includeComps ? 'comps' : 'paid'}] ${r.scanFrom}..${r.scanTo}: total ${r.total}, complete ${r.complete}${r.incompleteWindows?.length ? ' ' + JSON.stringify(r.incompleteWindows) : ''}\n`);
    baseline = r.total;
    from = addDays(r.scanTo, 1);
    if (r.scanTo >= to) break;
  }
  return { legs, to };
}

/** One row per calendar day across the legs, cumulative and daily added. */
function dailyRows(show, legs, to) {
  const byD = new Map();
  for (const leg of legs) for (const p of leg.series) byD.set(p.d, p.c);
  const from = legs[0].scanFrom;
  if (legs[legs.length - 1].scanTo < to) to = legs[legs.length - 1].scanTo;
  const rows = [];
  let cum = legs[0].series[0]?.c ?? 0;
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) {
    const d = daysBetween(show.open, cur);
    const prev = cum;
    if (byD.has(d)) cum = byD.get(d);
    rows.push({ date: cur, d, cumulative: cum, added: rows.length ? cum - prev : cum });
  }
  return rows;
}

function windowNumbers(rows) {
  const at = (d) => { let c = null; for (const r of rows) if (r.d <= d) c = r.cumulative; return c; };
  const added = (a, b) => rows.filter(r => r.d >= a && r.d <= b).reduce((s, r) => s + r.added, 0);
  return {
    beforeCampaign: at(DAY_BEFORE_CAMPAIGN),
    campaign: added(CAMPAIGN_FROM, CAMPAIGN_TO),
    atPlus16: at(CAMPAIGN_TO),
    final: rows[rows.length - 1].cumulative,
  };
}

fs.mkdirSync(OUT, { recursive: true });
const md = [`# Campaign-window numbers (fixed history-fill scan)`, ``, `Generated ${new Date().toISOString()} against ${BASE}.`, ``,
  `Windows are relative to opening night: cumulative at day ${DAY_BEFORE_CAMPAIGN}, tickets added from day ${CAMPAIGN_FROM} through day ${CAMPAIGN_TO} inclusive.`, ``];

for (const spec of SHOWS) {
  if (ONLY.length && !ONLY.includes(spec.name)) continue;
  const show = DATA.find(s => s.name === spec.name);
  if (!show) { md.push(`## ${spec.name}`, ``, `Not in pacingData.`, ``); continue; }
  md.push(`## ${show.name} (opens ${show.open}, baked final ${show.final ?? 'n/a'})`, ``);
  for (const basis of spec.bases || ['paid']) {
    const { legs, to } = await walk(show, basis === 'comps');
    const rows = dailyRows(show, legs, to);
    const w = windowNumbers(rows);
    const complete = legs.every(l => l.complete);
    const problems = legs.flatMap(l => l.incompleteWindows || []);
    const csv = path.join(OUT, `${slug(show.name)}${basis === 'comps' ? '-with-comps' : ''}.csv`);
    fs.writeFileSync(csv, 'date,days_to_opening,cumulative,daily_added\n'
      + rows.map(r => `${r.date},${r.d},${r.cumulative},${r.added}`).join('\n') + '\n');
    md.push(`### ${basis === 'comps' ? 'All seats (comps included)' : 'Net paid (comps excluded)'}`, ``,
      `| | |`, `|---|---|`,
      `| Scan | ${rows[0].date} to ${rows[rows.length - 1].date}, ${legs.length} leg(s), ${complete ? 'complete' : 'INCOMPLETE'} |`,
      `| Cumulative at day ${DAY_BEFORE_CAMPAIGN} (${addDays(show.open, DAY_BEFORE_CAMPAIGN)}) | ${w.beforeCampaign} |`,
      `| Added day ${CAMPAIGN_FROM} to +${CAMPAIGN_TO} (${addDays(show.open, CAMPAIGN_FROM)} to ${addDays(show.open, CAMPAIGN_TO)}) | ${w.campaign} |`,
      `| Cumulative at day +${CAMPAIGN_TO} | ${w.atPlus16} |`,
      `| Final cumulative | ${w.final} |`,
      `| Comps seen by the scan | ${legs.reduce((s, l) => s + (l.compTickets || 0), 0)} |`,
      ``, `Daily series: \`${csv}\``, ``);
    if (problems.length) md.push(`Unfinished windows: ${problems.join('; ')}`, ``);
  }
}
fs.writeFileSync(path.join(OUT, 'campaign-window.md'), md.join('\n'));
console.log(md.join('\n'));
