/**
 * Bake each show's performance date-times into src/data/pacingData.js.
 *
 *   node scripts/fill-performances.mjs [--base <url>] [--bypass <token>] [--show <name>]... [--dry] [--force]
 *
 * The dashboard places a show on its campaign axis after opening by the share
 * of performances played (src/lib/campaignAxis.js), which needs the run's
 * schedule. The data file carries that as `perfs`; a show without it is
 * placed by calendar share of its run instead, which is only right when the
 * performances are evenly spaced. This fills `perfs` for every show the
 * deployed instances route can still find, one request per show, without
 * rescanning orders. scripts/rebuild-pacing-data.mjs carries the field through
 * on later rebuilds. Shows that already have a list are skipped unless --force.
 */
import fs from 'fs';
import { DATA } from '../src/data/pacingData.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = (opt('--base', 'https://slorep-sales-dashboard.vercel.app')).replace(/\/$/, '');
const BYPASS = opt('--bypass', null);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const ONLY = args.flatMap((a, i) => (a === '--show' ? [args[i + 1]] : []));
const OUT = opt('--out', 'src/data/pacingData.js');

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {} });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(`${path}: ${res.status} ${body?.error || ''}`);
  return body;
}

const out = [];
let filled = 0, kept = 0, missing = 0;
for (const show of DATA) {
  if ((ONLY.length && !ONLY.includes(show.name)) || (!FORCE && show.perfs?.length)) { out.push(show); kept++; continue; }
  process.stderr.write(`${show.name}: `);
  try {
    const inst = await getJson(`/api/instances?name=${encodeURIComponent(show.name)}&open=${show.open}`);
    const perfs = inst.instances?.length
      ? inst.instances.map(i => i.dt)
      : (inst.past?.instances || []).filter(i => !i.cancelled).map(i => i.dt);
    if (!perfs.length) throw new Error('no performances listed');
    out.push({ ...show, perfs });
    filled++;
    process.stderr.write(`${perfs.length} performances, ${perfs[0].slice(0, 10)}..${perfs[perfs.length - 1].slice(0, 10)}\n`);
  } catch (err) {
    out.push(show);
    missing++;
    process.stderr.write(`kept as is: ${err.message}\n`);
  }
}
console.error(`\nfilled ${filled}, kept ${kept}, not found ${missing}`);
if (!DRY) {
  fs.writeFileSync(OUT, `export const DATA = ${JSON.stringify(out)};\n`);
  console.error(`wrote ${OUT}`);
}
