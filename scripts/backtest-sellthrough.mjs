/**
 * Does the projection actually predict final sell-through?
 *   node scripts/backtest-sellthrough.mjs
 *
 * The calibration script reports interval coverage. This reports the thing a
 * marketing decision rests on: at day X before opening, how far off is the
 * projected percentage of capacity from what the show finished at?
 *
 * Leave-one-show-out throughout — the centering is refit without the target
 * show before predicting it, so the model is never scored on its own answer.
 */
import { readFile } from 'node:fs/promises';

const MIN_PEERS = 3;
const SHRINK_PSEUDO_SHOWS = 4;
const CHECKPOINTS = [-30, -21, -14, -7, -3, -1];

const median = xs => quantile(xs, 0.5);
function quantile(xs, p) {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  const i = p * (a.length - 1), lo = Math.floor(i), hi = Math.min(lo + 1, a.length - 1);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
function lookupAt(series, d) {
  if (!series.length || series[series.length - 1].d < d) return null;
  let v = null;
  for (const p of series) { if (p.d <= d) v = p; else break; }
  return v;
}

function rawEstimate(target, pool, d) {
  const peers = pool.filter(p => p.name !== target.name && p.cat === target.cat);
  const pv = peers.map(p => lookupAt(p.series, d)).filter(Boolean);
  if (pv.length < MIN_PEERS) return null;
  const cPt = lookupAt(target.series, d);
  if (!cPt) return null;
  const peerMedPct = median(pv.map(v => v.p));
  if (!(peerMedPct > 0)) return null;
  const raw = cPt.c / (peerMedPct / 100);
  return raw > 0 ? raw : null;
}

/** Category centering, shrunk toward the pooled value, fit on d >= -30. */
function fitCentering(pool) {
  const obs = [];
  for (let d = -30; d <= 0; d++) {
    for (const x of pool) {
      const raw = rawEstimate(x, pool, d);
      if (raw) obs.push({ cat: x.cat, ratio: x.final / raw, name: x.name });
    }
  }
  const pooled = median(obs.map(o => o.ratio));
  const centre = {};
  for (const cat of new Set(obs.map(o => o.cat))) {
    const rs = obs.filter(o => o.cat === cat);
    const shows = new Set(rs.map(o => o.name)).size;
    const w = shows / (shows + SHRINK_PSEUDO_SHOWS);
    centre[cat] = w * median(rs.map(o => o.ratio)) + (1 - w) * pooled;
  }
  return { pooled, centre };
}

const raw = await readFile(new URL('../src/data/pacingData.js', import.meta.url), 'utf8');
const DATA = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
const completed = DATA.filter(
  x => x.series?.length && x.series.at(-1).c === x.final && x.final > 0 && x.cap > 0,
);

console.log(`completed shows with capacity: ${completed.length}\n`);
console.log('Projected vs actual sell-through, in percentage points of capacity.');
console.log('Leave-one-show-out: the model never sees the show it is predicting.\n');
console.log(`${'day'.padStart(5)} ${'n'.padStart(4)} ${'median err'.padStart(11)} ${'mean |err|'.padStart(11)} ${'p90 |err|'.padStart(10)}  ${'within 5pp'.padStart(10)} ${'within 10pp'.padStart(11)}`);

const rowsByDay = new Map();
for (const d of CHECKPOINTS) {
  const errs = [];
  for (const x of completed) {
    const pool = completed.filter(p => p.name !== x.name);
    const { pooled, centre } = fitCentering(pool);
    const rawEst = rawEstimate(x, pool, d);
    if (!rawEst) continue;
    const projected = Math.min(x.cap, rawEst * (centre[x.cat] ?? pooled));
    const projPct = projected / x.cap * 100;
    const actualPct = x.final / x.cap * 100;
    errs.push({ name: x.name, err: projPct - actualPct, projPct, actualPct });
  }
  if (errs.length < 4) continue;
  rowsByDay.set(d, errs);
  const abs = errs.map(e => Math.abs(e.err));
  const within = (t) => (abs.filter(a => a <= t).length / abs.length * 100);
  console.log(
    `${String(d).padStart(5)} ${String(errs.length).padStart(4)} ` +
    `${median(errs.map(e => e.err)).toFixed(1).padStart(10)}pp ` +
    `${(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(1).padStart(10)}pp ` +
    `${quantile(abs, 0.9).toFixed(1).padStart(9)}pp ` +
    `${within(5).toFixed(0).padStart(9)}% ${within(10).toFixed(0).padStart(10)}%`,
  );
}

// Worst misses at the decision point most people act on.
const at = rowsByDay.get(-14) || rowsByDay.get(-7);
if (at) {
  console.log('\nLargest misses at d-14 (projected vs actual, % of capacity):');
  for (const e of [...at].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 6)) {
    console.log(`  ${e.name.slice(0, 38).padEnd(38)} projected ${e.projPct.toFixed(0).padStart(3)}%  actual ${e.actualPct.toFixed(0).padStart(3)}%  ${e.err > 0 ? '+' : ''}${e.err.toFixed(0)}pp`);
  }
}

// How often does the run finish above capacity-implied 100%? Informs whether a
// 100% ceiling is ever the right clamp.
const over = completed.filter(x => x.final > x.cap).length;
console.log(`\nshows finishing above stated capacity: ${over} of ${completed.length}`);
const dist = completed.map(x => x.final / x.cap * 100).sort((a, b) => a - b);
console.log(`final sell-through across completed shows: p10 ${quantile(dist,0.1).toFixed(0)}%  median ${median(dist).toFixed(0)}%  p90 ${quantile(dist,0.9).toFixed(0)}%  max ${dist[dist.length-1].toFixed(0)}%`);

// --- Clamp sweep -------------------------------------------------------------
// The worst misses are all pinned at exactly 100%: the model wanted to project
// above capacity, got clamped to it, and capacity was still 30pp too high. No
// run in this data has ever finished above 96%. So what ceiling should a
// projection actually be clamped to?
console.log('\n--- Ceiling sweep: mean |error| in pp of capacity, leave-one-show-out ---');
const CLAMPS = [1.00, 0.95, 0.90, 0.85, 0.80];
console.log(`${'day'.padStart(5)} ` + CLAMPS.map(c => `${(c * 100).toFixed(0)}%`.padStart(8)).join('') + '   p95-of-peers');

for (const d of CHECKPOINTS) {
  const per = new Map(CLAMPS.map(c => [c, []]));
  const peerBased = [];
  for (const x of completed) {
    const pool = completed.filter(p => p.name !== x.name);
    const { pooled, centre } = fitCentering(pool);
    const rawEst = rawEstimate(x, pool, d);
    if (!rawEst) continue;
    const est = rawEst * (centre[x.cat] ?? pooled);
    const actualPct = x.final / x.cap * 100;
    for (const c of CLAMPS) {
      per.get(c).push(Math.abs(Math.min(x.cap * c, est) / x.cap * 100 - actualPct));
    }
    // Ceiling taken from what same-category peers actually achieved, rather
    // than from a round number: the 95th percentile of their final fill.
    const peerFinals = pool.filter(p => p.cat === x.cat).map(p => p.final / p.cap);
    const ceil = peerFinals.length >= 3 ? quantile(peerFinals, 0.95) : 1;
    peerBased.push(Math.abs(Math.min(x.cap * ceil, est) / x.cap * 100 - actualPct));
  }
  if (!per.get(1).length) continue;
  const mean = a => (a.reduce((s, v) => s + v, 0) / a.length);
  console.log(
    `${String(d).padStart(5)} ` +
    CLAMPS.map(c => `${mean(per.get(c)).toFixed(1)}pp`.padStart(8)).join('') +
    `   ${mean(peerBased).toFixed(1)}pp`,
  );
}
