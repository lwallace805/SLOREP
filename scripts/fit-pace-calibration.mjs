/**
 * Refits the pace-projection calibration in src/components/PacingDashboard.jsx
 * (PACE_CENTER, PACE_CENTER_DEFAULT, PACE_BANDS) from the season data.
 *
 * Run after adding completed shows to src/data/pacingData.js:
 *   node scripts/fit-pace-calibration.mjs
 *
 * The estimator being calibrated: tickets sold so far divided by the median
 * fraction-of-final that peer shows in the same category had reached on the same
 * day from opening. Fitting is leave-one-out — a show is never its own peer —
 * and restricted to d >= -30, the window where the dashboard shows a projection
 * at all, because the ratio is wildly unstable before that.
 *
 * Reported coverage is leave-one-SHOW-out: the calibration is refit from scratch
 * without the target show before predicting it, so it does not flatter itself.
 */
import { readFile } from 'node:fs/promises';

const MIN_PEERS = 3;
const BUCKETS = [[-30, -16], [-15, -8], [-7, -4], [-3, -2], [-1, 0]];
const SHRINK_PSEUDO_SHOWS = 4;   // pulls thin categories toward the pooled centre

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
const bucketOf = d => BUCKETS.find(([lo, hi]) => d >= lo && d <= hi);

/** actual-final / raw-estimate for every (show, day) the estimator can score. */
function observations(pool) {
  const out = [];
  for (let d = -30; d <= 0; d++) {
    for (const x of pool) {
      const peers = pool.filter(p => p.name !== x.name && p.cat === x.cat);
      const pv = peers.map(p => lookupAt(p.series, d)).filter(Boolean);
      if (pv.length < MIN_PEERS) continue;
      const cPt = lookupAt(x.series, d);
      if (!cPt) continue;
      const peerMedPct = median(pv.map(v => v.p));
      if (!(peerMedPct > 0)) continue;
      const raw = cPt.c / (peerMedPct / 100);
      if (raw > 0) out.push({ cat: x.cat, d, ratio: x.final / raw, name: x.name });
    }
  }
  return out;
}

function fit(obs) {
  const pooled = median(obs.map(o => o.ratio));
  const centre = {};
  for (const cat of new Set(obs.map(o => o.cat))) {
    const rs = obs.filter(o => o.cat === cat);
    const shows = new Set(rs.map(o => o.name)).size;
    const w = shows / (shows + SHRINK_PSEUDO_SHOWS);
    centre[cat] = w * median(rs.map(o => o.ratio)) + (1 - w) * pooled;
  }
  const bands = BUCKETS.map(b => {
    const res = obs.filter(o => bucketOf(o.d) === b || String(bucketOf(o.d)) === String(b))
                   .map(o => o.ratio / (centre[o.cat] ?? pooled));
    return [b[1], quantile(res, 0.10), quantile(res, 0.90)];
  });
  return { pooled, centre, bands };
}

const raw = await readFile(new URL('../src/data/pacingData.js', import.meta.url), 'utf8');
const DATA = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
// A run is only usable as calibration once it is finished, i.e. the series has
// actually reached the final figure.
const completed = DATA.filter(x => x.series?.length && x.series.at(-1).c === x.final && x.final > 0);

const { pooled, centre, bands } = fit(observations(completed));
console.log(`completed shows: ${completed.length}\n`);
console.log('const PACE_CENTER = {');
for (const [c, v] of Object.entries(centre).sort()) console.log(`  ${c}: ${v.toFixed(3)},`);
console.log('};');
console.log(`const PACE_CENTER_DEFAULT = ${pooled.toFixed(3)};`);
console.log('const PACE_BANDS = [');
for (const [maxD, lo, hi] of bands) console.log(`  [${maxD}, ${lo.toFixed(3)}, ${hi.toFixed(3)}],`);
console.log('];');

// Leave-one-show-out coverage of the nominal 80% interval.
let hit = 0, tot = 0;
for (const x of completed) {
  const pool = completed.filter(p => p.name !== x.name);
  const f = fit(observations(pool));
  const c = f.centre[x.cat] ?? f.pooled;
  for (let d = -30; d <= 0; d++) {
    const pv = pool.filter(p => p.cat === x.cat).map(p => lookupAt(p.series, d)).filter(Boolean);
    if (pv.length < MIN_PEERS) continue;
    const cPt = lookupAt(x.series, d);
    if (!cPt) continue;
    const peerMedPct = median(pv.map(v => v.p));
    if (!(peerMedPct > 0)) continue;
    const est = cPt.c / (peerMedPct / 100) * c;
    if (!(est > 0)) continue;
    const [, lo, hi] = f.bands.find(([maxD]) => d <= maxD);
    const cap = x.cap || Infinity;
    const low = Math.min(cap, Math.max(Math.round(est * lo), cPt.c));
    const high = Math.min(cap, Math.round(est * hi));
    if (x.final >= low && x.final <= high) hit++;
    tot++;
  }
}
console.log(`\nleave-one-show-out coverage of the 80% interval: ${(hit / tot * 100).toFixed(1)}%  (n=${tot})`);
