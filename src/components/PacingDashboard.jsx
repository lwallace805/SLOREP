'use client';

import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, ComposedChart
} from "recharts";

import { DATA } from '@/data/pacingData';
import { isOnSale, statusOf, currentShowName, pacificToday, daysFromOpen } from '@/lib/showStatus';
import TicketMixBar from './TicketMixBar';

const CATEGORIES = {
  revue:        { label: "Musical Revue",        color: "#D97706" },
  book_musical: { label: "Book Musical",          color: "#0F766E" },
  drama:        { label: "Drama",                 color: "#475569" },
  comedy:       { label: "Comedy",                color: "#B91C1C" },
  holiday:      { label: "Holiday",               color: "#15803D" },
  ubu:          { label: "Ubu's Other Shoe",       color: "#7C3AED" },
};

/**
 * Pace-extrapolation calibration, fitted by leave-one-out backtest over the 46
 * completed shows in pacingData. Regenerate with:
 *   node scripts/fit-pace-calibration.mjs
 *
 * The raw estimate divides tickets sold so far by the median fraction-of-final
 * peers had reached on the same day from opening, so it already asks "how far
 * ahead or behind peer pace are we, and where does that land?". It needs two
 * corrections on top.
 *
 * 1. Centering. The raw estimate runs hot: pooled over the d>=-30 window where
 *    it is shown at all, the median ratio of actual final to raw estimate is
 *    0.85. It varies by category, so each gets its own factor, shrunk toward
 *    the pooled value by the number of distinct shows behind it so that a
 *    five-show category cannot swing on one outlier.
 *
 * 2. A band that tightens as opening approaches. The previous model applied one
 *    flat per-category MAPE at every point in the run, which is far too wide the
 *    day before opening and far too narrow a month out. Measured, the 80%
 *    interval runs 40%-234% of the point estimate at d-30 and 75%-142% at d-1.
 */
const PACE_CENTER = { comedy: 0.905, drama: 0.953, revue: 0.910, ubu: 0.787 };
// book_musical and holiday have too few completed shows to fit their own.
const PACE_CENTER_DEFAULT = 0.852;

// [maxD, q10, q90] - first row whose maxD covers d wins. 80% interval,
// as a multiple of the centered point estimate.
const PACE_BANDS = [
  [-16, 0.401, 2.342],
  [-8,  0.515, 1.825],
  [-4,  0.579, 1.729],
  [-2,  0.653, 1.648],
  [0,   0.753, 1.417],
];
function paceBand(d) {
  for (const [maxD, lo, hi] of PACE_BANDS) if (d <= maxD) return [lo, hi];
  return [0.753, 1.417];
}

const RECENT_SEASONS = new Set(["24-25", "25-26"]);
const MILESTONE_BASE = [-180, -90, -60, -30, -15, -7, -3, -1, 0, 7, 14, 21];
const MILESTONES = MILESTONE_BASE; // kept for compat

function lookupAt(series, d) {
  if (!series.length) return null;
  const maxD = series[series.length - 1].d;
  if (maxD < d) return null;
  let v = null;
  for (const p of series) {
    if (p.d <= d) v = p;
    else break;
  }
  return v;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export default function PacingDashboard({ initialLiveData = {}, runWindows = {} }) {
  // Lifecycle comes from the run window, never from the data file's inProgress
  // flag — see src/lib/showStatus.js for why.
  const today = useMemo(() => pacificToday(), []);
  const onSaleNames = useMemo(
    () => new Set(DATA.filter(s => isOnSale(s, runWindows, today)).map(s => s.name)),
    [runWindows, today]
  );
  // `show` here may be a liveDATA copy, so match on name rather than identity.
  const onSale = (show) => !!show && onSaleNames.has(show.name);

  // Open the dashboard on the production being marketed right now: of the shows
  // whose run has not ended, the one opening soonest.
  const defaultCurrent = useMemo(
    () => currentShowName(DATA, runWindows, today) || DATA[DATA.length - 1].name,
    [runWindows, today]
  );
  const [currentName, setCurrentName] = useState(defaultCurrent);
  const [liveData, setLiveData] = useState(initialLiveData);
  // Per show: true when the order scan behind the gap fill came back short, so
  // the stretch between the export and today is understated rather than measured.
  const [gapPartial, setGapPartial] = useState({});
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(
    Object.keys(initialLiveData).length ? new Date() : null
  );
  const [gapSeries, setGapSeries] = useState({});  // { showName: [{d,c},...] }

  // Live data is fetched for the selected show only. Fetching every on-sale
  // show on mount meant seven Spektrix round-trips for six charts nobody was
  // looking at; selecting a show is what makes its numbers worth pulling.
  const selectedShow = DATA.find(s => s.name === currentName);
  const selectedIsLive = onSale(selectedShow) && selectedShow?.series.length > 0;

  useEffect(() => {
    if (!selectedIsLive) return;
    let cancelled = false;
    const show = selectedShow;
    const lastPt = show.series[show.series.length - 1];
    const [oy, om, od] = show.open.split('-').map(Number);
    const openUtcMs = Date.UTC(oy, om - 1, od);
    const baseDateStr = new Date(openUtcMs + lastPt.d * 86400000).toISOString().slice(0, 10);

    const fetchLive = () => {
      const params = new URLSearchParams({
        name: show.name,
        baselineDate: baseDateStr,
        baselineCount: String(lastPt.c),
        openDate: show.open,
      });
      fetch(`/api/live-pacing?${params}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled || data.error) return;
          setLiveData(prev => ({ ...prev, [show.name]: data }));
          setLiveUpdatedAt(new Date());
        })
        .catch(() => {});
    };

    fetchLive();
    const interval = setInterval(fetchLive, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [currentName, selectedIsLive]);

  // Fill the gap between the last static export point and today with real
  // per-day order counts, so the milestone rows in between are measured rather
  // than interpolated.
  useEffect(() => {
    if (!selectedIsLive) return;
    let cancelled = false;
    const show = selectedShow;
    const lastPt = show.series[show.series.length - 1];
    const [oy, om, od] = show.open.split('-').map(Number);
    const openUtcMs = Date.UTC(oy, om - 1, od);
    const fromDate = new Date(openUtcMs + (lastPt.d + 1) * 86400000).toISOString().slice(0, 10);
    if (fromDate > today) return;

    const params = new URLSearchParams({
      name: show.name,
      fromDate,
      baselineCount: String(lastPt.c),
      openDate: show.open,
    });
    fetch(`/api/history-fill?${params}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled || data.error || !data.series?.length) return;
        setGapSeries(prev => ({ ...prev, [show.name]: data.series }));
        setGapPartial(prev => ({ ...prev, [show.name]: {
            complete: data.complete !== false,
            found: data.found ?? 0,
            lastError: data.lastError || null,
            ordersSeen: data.ordersSeen ?? null,
          } }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentName, selectedIsLive, today]);

  const getLiveSeries = (show) => {
    if (!onSale(show)) return show.series;
    const live = liveData[show.name];
    const gap  = gapSeries[show.name]; // [{d,c}] from history-fill
    const meta = gapPartial[show.name];
    const realCap = (live?.cap > 0 ? live.cap : show.cap);
    const pctOf = c => (realCap > 0 ? Math.round(c / realCap * 1000) / 10 : 0);

    // Start from static export points
    let base = [...show.series];
    const lastStaticC = base[base.length - 1]?.c ?? 0;
    const unexplained = (live?.c ?? 0) - lastStaticC;

    // Only merge the gap when it actually accounts for the movement. A scan that
    // completes but matches no orders yields a flat run at the export figure,
    // and its closing point lands on today's day number — where it would
    // suppress the live total rather than be replaced by it. A flat line that
    // says "nothing sold for three months" is worse than no line at all.
    const gapTrusted =
      gap?.length > 0 &&
      (unexplained < 20 || (meta?.complete && (meta.found ?? 0) >= unexplained * 0.5));

    if (gapTrusted) {
      const maxStaticD = base[base.length - 1]?.d ?? -Infinity;
      base = [
        ...base,
        ...gap.filter(pt => pt.d > maxStaticD).map(pt => ({ d: pt.d, c: pt.c, p: pctOf(pt.c) })),
      ];
    }

    // The live availability reading is the authority on how many seats are gone
    // right now. It supersedes anything sitting on or after its day instead of
    // yielding to it on a tie.
    if (live?.c > 0 && live.d >= (base[base.length - 1]?.d ?? -Infinity) ) {
      base = base.filter(pt => pt.d < live.d);
      const c = Math.max(live.c, base[base.length - 1]?.c ?? 0);
      base = [...base, { d: live.d, c, p: pctOf(c) }];
    }

    return base;
  };

  const liveApplied = useMemo(() => {
    const applied = {};
    DATA.forEach(show => {
      if (!onSale(show)) return;
      const live = liveData[show.name];
      if (live && live.c > 0) applied[show.name] = true;
    });
    return applied;
  }, [liveData]);

  const liveDATA = useMemo(() => DATA.map(show => {
    const series = getLiveSeries(show);
    // For a show still on sale the data file's `final` is not a final — it is
    // whatever had sold on the day of the last export. The Father's said 31,
    // frozen on 2026-06-01. Use the live count instead, and fall back to the
    // last point of the series rather than that stale number.
    const soldSoFar = Math.max(
      liveApplied[show.name] ? liveData[show.name].c : 0,
      series[series.length - 1]?.c ?? 0
    );
    return {
      ...show,
      series,
      final: onSale(show) ? soldSoFar : show.final,
      // Use real cap from Spektrix when available (excludes cancelled performances)
      cap: (liveApplied[show.name] && liveData[show.name]?.cap > 0)
        ? liveData[show.name].cap
        : show.cap,
    };
  }), [liveData, liveApplied, gapSeries, gapPartial, onSaleNames]);

  const current = liveDATA.find(s => s.name === currentName) || liveDATA[0];

  /**
   * True when the curve between the last export point and today is not real.
   * Either the order scan came back short, or it completed but found nothing
   * while the live total sits well above the last export figure — which cannot
   * both be true. Drawing a flat line across that stretch asserts "nothing sold
   * for weeks, then everything sold today", which is what the gap looked like
   * before this was surfaced.
   */
  const gapUnmeasured = useMemo(() => {
    if (!onSale(current)) return false;
    const meta = gapPartial[current.name];
    const staticShow = DATA.find(x => x.name === current.name);
    const lastStatic = staticShow?.series?.[staticShow.series.length - 1];
    const liveNow = liveData[current.name]?.c;
    if (!lastStatic || !liveNow) return false;
    const unexplained = liveNow - lastStatic.c;
    if (unexplained < 20) return false;               // nothing meaningful to explain
    if (!meta) return true;                            // fill never returned
    return !meta.complete || meta.found < unexplained * 0.5;
  }, [current, gapPartial, liveData]);

  const [peerCats, setPeerCats] = useState(new Set([current.cat]));
  const [peerSeasons, setPeerSeasons] = useState(new Set(["22-23", "23-24", "24-25", "25-26", "26-27"]));
  const [excludeInProgress, setExcludeInProgress] = useState(true);

  const peers = useMemo(() => liveDATA.filter(s =>
    s.name !== currentName
    && peerCats.has(s.cat)
    && peerSeasons.has(s.season)
    && (!excludeInProgress || !onSale(s))
  ), [liveDATA, currentName, peerCats, peerSeasons, excludeInProgress, onSaleNames]);

  // Only a closed run has a final worth taking a median of. A show still on
  // sale would drag the benchmark down with a part-sold total.
  const closedPeers = useMemo(() => peers.filter(p => !onSale(p)), [peers, onSaleNames]);

  const currentToday = current.series[current.series.length - 1] || null;

  // The last point of the series is only "today" if it actually is today. For a
  // show still on sale, today's day-number comes from the calendar; when live
  // data has not arrived, the newest point can be months behind it. Presenting
  // a stale export as the current position is how The Father came to read as
  // "31 tickets sold, 88 days before opening" three days out from opening.
  const trueTodayD = onSale(current) ? daysFromOpen(current.open, today) : null;
  const staleBy = (trueTodayD !== null && currentToday)
    ? trueTodayD - currentToday.d : 0;
  const isStale = staleBy > 1;

  const dynamicMilestones = useMemo(() => {
    if (!currentToday) return MILESTONE_BASE;
    const td = currentToday.d;
    if (MILESTONE_BASE.includes(td)) return MILESTONE_BASE;
    return [...MILESTONE_BASE, td].sort((a, b) => a - b);
  }, [currentToday]);

  const milestoneRows = useMemo(() => {
    return dynamicMilestones.map(d => {
      const cPt = lookupAt(current.series, d, true);
      const peerData = peers.map(p => {
        const pt = lookupAt(p.series, d, true);
        // A peer still on sale has no final to contribute to the benchmark.
        return pt ? { tix: pt.c, pct: pt.p, name: p.name, final: onSale(p) ? null : p.final, cap: p.cap, capPct: (pt.c / p.cap) * 100 } : null;
      }).filter(Boolean);
      const peerTix = peerData.map(v => v.tix);
      const peerPct = peerData.map(v => v.pct);
      const peerFinals = peerData.map(v => v.final).filter(v => v != null);
      const peerCapPct = peerData.map(v => v.capPct);
      const peerMedTix = median(peerTix);
      const peerMedPct = median(peerPct);
      const peerMedFinal = median(peerFinals);
      const peerMedCapPct = median(peerCapPct);
      const MIN_PEERS = 3;
      // Delta: compare % of capacity (not raw tickets) so shows with different house sizes are comparable
      const currentCapPctHere = cPt && current.cap ? (cPt.c / current.cap * 100) : null;
      const delta = (currentCapPctHere !== null && peerMedCapPct !== null && peerData.length >= MIN_PEERS)
        ? currentCapPctHere - peerMedCapPct : null;
      const projection = (cPt && peerMedPct && peerMedPct > 0 && d >= -30 && peerData.length >= MIN_PEERS)
        ? Math.round(cPt.c / (peerMedPct / 100)) : null;
      return {
        d, currentTix: cPt ? cPt.c : null,
        currentCapPct: cPt && current.cap ? (cPt.c / current.cap) * 100 : null,
        peerMedTix, peerMedPct, peerMedCapPct,
        peerMin: peerTix.length ? Math.min(...peerTix) : null,
        peerMax: peerTix.length ? Math.max(...peerTix) : null,
        peerN: peerData.length, delta, projection, peerMedFinal,
      };
    });
  }, [current, peers, dynamicMilestones]);

  const headline = useMemo(() => {
    if (!currentToday || !peers.length) return null;
    let d = currentToday.d;
    let peerVals = peers.map(p => lookupAt(p.series, d)).filter(Boolean);
    while (!peerVals.length && d > -400) { d--; peerVals = peers.map(p => lookupAt(p.series, d)).filter(Boolean); }
    if (!peerVals.length) return null;
    const cPt = lookupAt(current.series, d);
    if (!cPt) return null;
    const peerMed = median(peerVals.map(v => v.c));
    const peerMedPct = median(peerVals.map(v => v.p));
    // Cap-based delta: current % of capacity minus peer median % of capacity
    const peerWithCap = peers.map(p => {
      const pt = lookupAt(p.series, d);
      return pt && p.cap ? pt.c / p.cap * 100 : null;
    }).filter(v => v !== null);
    const peerMedCapPct = median(peerWithCap);
    const currentCapPctNow = current.cap ? cPt.c / current.cap * 100 : null;
    const delta = (currentCapPctNow !== null && peerMedCapPct !== null && peerVals.length >= 3)
      ? currentCapPctNow - peerMedCapPct : null;
    const rawProjection = (peerMedPct && peerMedPct > 0 && d >= -30 && peerVals.length >= 3)
      ? Math.round(cPt.c / (peerMedPct / 100)) : null;
    const centre = PACE_CENTER[current.cat] ?? PACE_CENTER_DEFAULT;
    const [bandLo, bandHi] = paceBand(d);
    const cap = current.cap || Infinity;
    const calibrated = rawProjection ? rawProjection * centre : null;
    const projection = calibrated != null ? Math.min(cap, Math.round(calibrated)) : null;
    const rawLow = calibrated != null ? Math.round(calibrated * bandLo) : null;
    // A run cannot finish below what is already banked, so the low end stays
    // floored at tickets sold. That clamp is a backstop, not a forecast: when it
    // binds, the card says so rather than passing it off as the model's floor.
    const projectionLow  = rawLow != null ? Math.min(cap, Math.max(rawLow, cPt.c)) : null;
    const projectionHigh = calibrated != null ? Math.min(cap, Math.round(calibrated * bandHi)) : null;
    const lowIsClamped = rawLow != null && rawLow < cPt.c;
    // Where this show sits against peer pace right now, as a ratio of percent of
    // capacity sold at the same day. 1.00 is exactly on peer pace.
    const paceIndex = (currentCapPctNow !== null && peerMedCapPct) ? currentCapPctNow / peerMedCapPct : null;
    const peerMedFinal = median(closedPeers.map(p => p.final));
    return { d, currentTix: cPt.c, peerMed, delta, projection, projectionLow, projectionHigh, peerMedFinal,
             peerN: peerVals.length, centre, bandLo, bandHi, paceIndex, lowIsClamped };
  }, [currentToday, peers, closedPeers, current]);

  const chartData = useMemo(() => {
    const xMin = -120, xMax = 28;
    const out = [];
    for (let d = xMin; d <= xMax; d++) {
      const row = { d };
      const cPt = lookupAt(current.series, d);
      if (cPt !== null) row.current = cPt.c;
      const peerVals = peers.map(p => lookupAt(p.series, d)).filter(Boolean).map(v => v.c);
      if (peerVals.length) {
        row.peerMed = median(peerVals);
        row.peerP25 = percentile(peerVals, 0.25);
        row.peerP75 = percentile(peerVals, 0.75);
        row.peerBand = row.peerP75 - row.peerP25;
      }
      out.push(row);
    }
    return out;
  }, [current, peers]);

  const todayD = currentToday ? currentToday.d : null;
  const toggleCat = c => { const n = new Set(peerCats); n.has(c) ? n.delete(c) : n.add(c); setPeerCats(n); };
  const toggleSeason = s => { const n = new Set(peerSeasons); n.has(s) ? n.delete(s) : n.add(s); setPeerSeasons(n); };
  const sortedShows = [...liveDATA].sort((a, b) => b.open.localeCompare(a.open));
  const catColor = CATEGORIES[current.cat]?.color || "#7a7570";
  const STATUS_LABEL = { running: "In Progress", upcoming: "On Sale", past: "Past" };
  const showStatus = (s) => STATUS_LABEL[statusOf(s, runWindows, today)];

  const projRangeBar = useMemo(() => {
    if (!headline?.projection || !headline?.projectionLow || !headline?.projectionHigh || !current.cap) return null;
    const floorPct = (headline.projectionLow / current.cap * 100);
    const midPct   = Math.min(100, headline.projection / current.cap * 100);
    const ceilPct  = Math.min(100, headline.projectionHigh / current.cap * 100);
    return { floorPct, midPct, ceilPct, fillLeft: floorPct, fillWidth: Math.max(0, ceilPct - floorPct), markerLeft: midPct };
  }, [headline, current]);

  return (
    <div style={{ background: "#fffdf9", minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", color: "#1c1a18" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
        body { margin: 0; }
        .pd-serif { font-family: 'Playfair Display', Georgia, serif; }
        table.ms { border-collapse: collapse; width: 100%; }
        table.ms th, table.ms td { padding: 9px 12px; text-align: right; border-bottom: 1px solid #f0ebe4; font-size: 13px; }
        table.ms th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7a7570; font-weight: 600; border-bottom: 1px solid #e4ddd5; text-align: right; vertical-align: bottom; }
        table.ms td.lbl, table.ms th.lbl { text-align: left; }
        table.ms tr.future td { color: #bbb1a0; }
        table.ms tr.future td.lbl { color: #7a7570; }
        table.ms tr.now td { background: #f0fdf4; border-bottom-color: #bbf7d0; }
        table.ms tr.now td.lbl { color: #065f46; font-weight: 600; }
        table.ms tr:not(.now):not(.future):hover td { background: #f7f2eb; }
        @keyframes pd-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .pd-stat-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 20px; }
        .pd-two-col { display: grid; grid-template-columns: 1fr 320px; gap: 18px; align-items: start; }
        .pd-outer { max-width: 1340px; margin: 0 auto; padding: 32px 40px; }
        @media (max-width: 900px) {
          .pd-stat-grid { grid-template-columns: repeat(2,1fr) !important; }
          .pd-two-col { grid-template-columns: 1fr !important; }
          .pd-outer { padding: 20px 16px !important; }
          table.ms th, table.ms td { padding: 7px 8px !important; font-size: 11px !important; }
        }
        @media (max-width: 540px) {
          .pd-stat-grid { grid-template-columns: 1fr 1fr !important; }
          .pd-two-col { grid-template-columns: 1fr !important; }
          table.ms { font-size: 11px; }
          table.ms th:nth-child(n+5), table.ms td:nth-child(n+5) { display: none; }
        }
      `}</style>

      <div className="pd-outer">

        {/* Header */}
        <div style={{ borderBottom: "1px solid #e4ddd5", paddingBottom: 20, marginBottom: 22 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7a7570" }}>
            SLO Rep · Marketing Analytics
          </div>
          <h1 className="pd-serif" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, margin: "5px 0 4px", color: "#1c1a18" }}>
            Ticket Pacing
          </h1>
          <div style={{ fontSize: 12.5, color: "#7a7570", display: "flex", alignItems: "center", gap: 6 }}>
            Cumulative sales vs peer shows at the same stage
            <span style={{ color: "#22c55e", fontWeight: 600 }}>· Live via Spektrix</span>
          </div>
        </div>

        {/* Show selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a7570", whiteSpace: "nowrap" }}>Show</span>
          <select value={currentName} onChange={e => { const s = liveDATA.find(x => x.name === e.target.value); setCurrentName(e.target.value); setPeerCats(new Set([s.cat])); }} style={selectStyle}>
            {sortedShows.map(s => (
              <option key={s.name} value={s.name}>
                {s.name} · {s.season} · {CATEGORIES[s.cat]?.label || s.cat} · {showStatus(s)}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11.5, color: "#bbb1a0" }}>
            {current.season} · {CATEGORIES[current.cat]?.label || current.cat}
            {trueTodayD !== null && ` · ${trueTodayD <= 0 ? Math.abs(trueTodayD) + "d out" : "+" + trueTodayD + "d"} today`}
            {trueTodayD === null && currentToday !== null && ` · closed`}
            {current.cap ? ` · ${current.cap.toLocaleString()} cap` : ""}
          </span>
          {isStale && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#b45309", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 100, padding: "3px 9px" }}>
              {`Live data unavailable · figures as of ${staleBy} ${staleBy === 1 ? "day" : "days"} ago`}
            </span>
          )}
          {onSale(current) && liveApplied[current.name] && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#22c55e", background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.25)", borderRadius: 100, padding: "3px 9px" }}>
              <span style={{ width: 5, height: 5, background: "#22c55e", borderRadius: "50%", animation: "pd-pulse 2s infinite", display: "inline-block" }} />
              Live
              {liveUpdatedAt && <span style={{ fontWeight: 400, marginLeft: 4, color: "#7a7570" }}>{liveUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            </span>
          )}
        </div>

        {/* 4 stat cards */}
        {headline && (
          <div className="pd-stat-grid">
            <StatCard accent="#0f766e" label="Run Total Sold"
              value={headline.currentTix.toLocaleString()}
              sub={`of ${current.cap?.toLocaleString()} capacity`} />
            <StatCard accent="#b02629" label="Overall Fill"
              value={(headline.currentTix / current.cap * 100).toFixed(1) + "%"}
              valueColor="#0f766e"
              sub={headline.d <= 0 ? `${Math.abs(headline.d)}d before opening` : `+${headline.d}d into run`} />
            <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "18px 20px 16px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "12px 12px 0 0", background: "#d97706" }} />
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.11em", textTransform: "uppercase", color: "#7a7570", marginBottom: 7 }}>Vs Peer Median</div>
              <div className="pd-serif" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, paddingTop: 3, color: "#1c1a18" }}>
                {headline.delta != null ? (headline.delta > 0 ? "+" : "") + headline.delta.toFixed(1) + "pp" : "—"}
              </div>
              <div style={{ fontSize: 10.5, color: "#7a7570", marginTop: 3 }}>% capacity vs peer median</div>
              {headline.delta != null ? (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, marginTop: 6, padding: "3px 8px", borderRadius: 100,
                  background: headline.delta > 3 ? "#ccfbf1" : headline.delta < -3 ? "#fee2e2" : "#f1f5f9",
                  color: headline.delta > 3 ? "#0f766e" : headline.delta < -3 ? "#dc2626" : "#475569"
                }}>
                  {headline.delta > 3 ? "\u2191 Ahead of pace" : headline.delta < -3 ? "\u2193 Behind pace" : "On pace"}
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: "#7a7570", marginTop: 5 }}>need \u22653 peers ({headline.peerN} now)</div>
              )}
            </div>
            <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "18px 20px 16px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "12px 12px 0 0", background: "#475569" }} />
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.11em", textTransform: "uppercase", color: "#7a7570", marginBottom: 7 }}>Projected Final (calibrated)</div>
              <div className="pd-serif" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, paddingTop: 3, color: "#1c1a18" }}>
                {headline.projection ? `~${headline.projection.toLocaleString()}` : headline.d < -30 ? "too early" : "\u2014"}
              </div>
              {projRangeBar ? (
                <>
                  <div style={{ position: "relative", height: 6, background: "#f0ebe4", borderRadius: 100, margin: "10px 0 4px", overflow: "visible" }}>
                    <div style={{ position: "absolute", top: 0, left: projRangeBar.fillLeft + "%", width: projRangeBar.fillWidth + "%", height: "100%", background: "linear-gradient(90deg,#6ee7b7,#a7f3d0)", borderRadius: 100 }} />
                    <div style={{ position: "absolute", top: -4, left: projRangeBar.markerLeft + "%", width: 14, height: 14, background: "#0f766e", border: "2.5px solid #fff", borderRadius: "50%", transform: "translateX(-50%)", boxShadow: "0 1px 4px rgba(0,0,0,.12)" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7a7570" }}>
                    <span>{projRangeBar.floorPct.toFixed(0)}% floor</span>
                    <span style={{ fontWeight: 600, color: "#0f766e" }}>~{projRangeBar.midPct.toFixed(0)}%</span>
                    <span>{projRangeBar.ceilPct.toFixed(0)}% ceiling</span>
                  </div>
                </>
              ) : (
                headline.projection && headline.peerMedFinal ? (
                  <div style={{ fontSize: 11.5, color: "#7a7570", marginTop: 5 }}>
                    peer median final: {Math.round(headline.peerMedFinal).toLocaleString()}
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}

        {/* Two-column layout: main content + right sidebar */}
        <div className="pd-two-col">

        {/* LEFT COLUMN */}
        <div>

        {/* Filter panel */}
        <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, marginBottom: 18, overflow: "hidden" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 16px", background: "#f7f2eb", borderBottom: "1px solid #f0ebe4", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "#7a7570", marginRight: 8, whiteSpace: "nowrap" }}>Peer shows</span>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <CatChip key={k} active={peerCats.has(k)} color={v.color} onClick={() => toggleCat(k)}>{v.label}</CatChip>
            ))}
            <span style={{ width: 1, height: 18, background: "#e4ddd5", margin: "0 4px", flexShrink: 0, display: "inline-block" }} />
            {["22-23", "23-24", "24-25", "25-26", "26-27"].map(s => (
              <Chip key={s} active={peerSeasons.has(s)} onClick={() => toggleSeason(s)}>{s}</Chip>
            ))}
            <label style={{ marginLeft: 8, fontSize: 11, color: "#7a7570", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={excludeInProgress} onChange={e => setExcludeInProgress(e.target.checked)} />
              exclude shows still on sale
            </label>
          </div>
          <div style={{ padding: "8px 16px", fontSize: 12, color: "#7a7570" }}>
            <span style={{ fontWeight: 600, color: "#1c1a18" }}>{peers.length}</span> peer show{peers.length === 1 ? "" : "s"} in selection
          </div>
        </div>

        {/* Chart */}
        <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "20px 16px 12px", marginBottom: 18 }}>
          <div style={{ padding: "0 8px 12px", borderBottom: "1px solid #f0ebe4", display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.11em", textTransform: "uppercase", color: "#7a7570" }}>Pacing curve</div>
              <div className="pd-serif" style={{ fontSize: 16, fontWeight: 600, marginTop: 2, color: "#1c1a18" }}>
                {currentName} <span style={{ color: "#7a7570", fontWeight: 400, fontSize: 14 }}>vs peer median + 25–75th percentile band</span>
              </div>
              {gapUnmeasured && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 9px", display: "inline-block" }}>
                  Day-by-day history unavailable between the last export and today — the curve jumps rather than climbing. Totals are correct; the shape in between is not.
                  {gapPartial[current.name]?.lastError && (
                    <div style={{ marginTop: 3, fontSize: 10, color: "#a16207", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {gapPartial[current.name].ordersSeen != null && `orders seen: ${gapPartial[current.name].ordersSeen} · `}
                      {gapPartial[current.name].lastError}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#7a7570", display: "flex", gap: 14 }}>
              <Legend swatch="#1c1a18" label="this show" />
              <Legend swatch={catColor} label="peer median" />
              <Legend swatch={catColor + "33"} label="25–75% range" />
            </div>
          </div>
          <div style={{ height: 380, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 12, right: 24, bottom: 28, left: 12 }}>
                <CartesianGrid stroke="#f0ebe4" strokeDasharray="3 3" />
                <XAxis dataKey="d" type="number" domain={[-120, 28]}
                  tick={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fill: "#7a7570" }}
                  tickFormatter={v => v === 0 ? "open" : (v > 0 ? `+${v}d` : `${v}d`)}
                  stroke="#e4ddd5" />
                <YAxis tick={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fill: "#7a7570" }} stroke="#e4ddd5" />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 6, fontSize: 12, fontFamily: "'Inter', sans-serif" }}
                  labelFormatter={d => `${d > 0 ? "+" : ""}${d}d from opening`}
                  formatter={(v, n) => {
                    if (v == null) return ["—", n];
                    const labels = { current: currentName, peerMed: "Peer median", peerP25: "25th pct", peerP75: "75th pct", peerBand: "75th pct" };
                    return [Math.round(v).toLocaleString(), labels[n] || n];
                  }}
                />
                {MILESTONE_BASE.map(d => (
                  <ReferenceLine key={d} x={d} stroke="#e4ddd5" strokeDasharray="2 4" />
                ))}
                <ReferenceLine x={0} stroke="#1c1a18" strokeWidth={1.2} label={{ value: "Opening", position: "top", fontSize: 10, fill: "#1c1a18" }} />
                {onSale(current) && (trueTodayD ?? todayD) !== null && (
                  <ReferenceLine x={trueTodayD ?? todayD} stroke="#0f766e" strokeWidth={1.2} strokeDasharray="4 2"
                    label={{ value: "Today", position: "top", fontSize: 10, fill: "#0f766e" }} />
                )}
                <Area type="monotone" dataKey="peerP25" stackId="band" stroke="none" fill="transparent" />
                <Area type="monotone" dataKey="peerBand" stackId="band" stroke="none" fill={catColor} fillOpacity={0.15} />
                <Line type="monotone" dataKey="peerMed" stroke={catColor} strokeWidth={2.2} dot={false} connectNulls />
                <Line type="monotone" dataKey="current" stroke="#1c1a18" strokeWidth={3} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Milestone table */}
        <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "8px 20px 20px", marginBottom: 18 }}>
          <div style={{ padding: "14px 0 10px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a7570", fontWeight: 600 }}>Milestone comparison</div>
            <div className="pd-serif" style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: "#1c1a18" }}>
              {currentName} <span style={{ color: "#7a7570", fontWeight: 400 }}>vs {peers.length} peer{peers.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <table className="ms">
            <thead>
              <tr>
                <th className="lbl">Days from opening</th>
                <th>This show<br/><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#bbb1a0" }}>tickets</span></th>
                <th>% of capacity</th>
                <th>Peer median<br/><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#bbb1a0" }}>tickets</span></th>
                <th>Peer % of final<br/><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#bbb1a0" }}>median</span></th>
                <th>Δ cap% vs peers</th>
                <th>Peer range</th>
              </tr>
            </thead>
            <tbody>
              {milestoneRows.map((r, ri) => {
                const isFuture = r.currentTix === null && todayD !== null && todayD < r.d;
                const lastReachedMs = [...milestoneRows].filter(x => x.currentTix !== null).pop();
                const isNow = onSale(current) && r === lastReachedMs;
                const lowConfidence = r.peerN < 3 && !isFuture;
                const divider = r.d === 7 ? (
                  <tr key="divider-opening">
                    <td colSpan={7} style={{ padding: 0, borderBottom: "2px solid #e4ddd5", borderTop: "2px solid #e4ddd5" }}>
                      <div style={{ padding: "5px 12px", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a7570", fontWeight: 600, background: "#f7f2eb" }}>
                        Post-opening · into the run ↓
                      </div>
                    </td>
                  </tr>
                ) : null;
                return (
                  <React.Fragment key={r.d}>
                    {divider}
                    <tr className={isFuture ? "future" : isNow ? "now" : ""} style={{ opacity: lowConfidence ? 0.6 : 1 }}>
                      <td className="lbl" style={{ fontFamily: "'Inter', monospace" }}>
                        {labelForDay(r.d)}{isNow ? " · today" : ""}
                        {lowConfidence && <span title={`Only ${r.peerN} peer${r.peerN === 1 ? "" : "s"} at this milestone`} style={{ marginLeft: 6, fontSize: 10, color: "#b45309", background: "#fef3c7", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>low n</span>}
                      </td>
                      <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {r.currentTix !== null ? r.currentTix.toLocaleString() : "—"}
                      </td>
                      <td style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>
                        {r.currentCapPct !== null ? r.currentCapPct.toFixed(1) + "%" : "—"}
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.peerMedTix !== null ? Math.round(r.peerMedTix).toLocaleString() : "—"}</td>
                      <td style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>
                        {r.peerMedPct !== null ? r.peerMedPct.toFixed(1) + "%" : "—"}
                      </td>
                      <td style={{
                        fontWeight: 600, fontVariantNumeric: "tabular-nums",
                        color: r.delta === null ? "#bbb1a0" : r.delta > 3 ? "#0f766e" : r.delta < -3 ? "#b91c1c" : "#475569"
                      }}>
                        {r.delta !== null ? (r.delta > 0 ? "+" : "") + r.delta.toFixed(1) + "pp" : "—"}
                      </td>
                      <td style={{ color: "#7a7570", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                        {r.peerMin !== null ? `${Math.round(r.peerMin).toLocaleString()}–${Math.round(r.peerMax).toLocaleString()}` : "—"}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 11, color: "#7a7570", lineHeight: 1.5 }}>
            <strong style={{ color: "#7a5b1c" }}>Caveat:</strong> Early milestones (−180, −90, −60) are dominated by subscriber seat allocations.
            Single-ticket marketing response shows clearest from −60 days in.
          </div>
        </div>

        {/* Peer reference table */}
        <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "8px 20px 20px", marginBottom: 18 }}>
          <div style={{ padding: "14px 0 10px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a7570", fontWeight: 600 }}>Peer reference</div>
            <div className="pd-serif" style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: "#1c1a18" }}>
              This show vs peers in this comparison
            </div>
          </div>
          <table className="ms">
            <thead>
              <tr>
                <th className="lbl">Show</th>
                <th className="lbl">Category</th>
                <th className="lbl">Season</th>
                <th>Opening</th>
                <th>Capacity</th>
                <th>Tickets</th>
                <th>% of cap</th>
                <th>Projected sell-through</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const currentTix = currentToday ? currentToday.c : current.final;
                const currentCapPct = current.cap ? (currentTix / current.cap * 100).toFixed(1) + "%" : "—";
                const projectedFinal = headline && headline.projection ? headline.projection : null;
                const projLow = headline?.projectionLow;
                const projHigh = headline?.projectionHigh;
                const projectedPct = projectedFinal && current.cap
                  ? (projLow && projHigh
                      ? `${(projLow/current.cap*100).toFixed(0)}–${Math.min(100,(projHigh/current.cap*100)).toFixed(0)}%`
                      : (projectedFinal/current.cap*100).toFixed(1)+"%")
                  : onSale(current) ? "—" : (current.final && current.cap ? (current.final/current.cap*100).toFixed(1)+"%" : "—");
                const cat = CATEGORIES[current.cat] || { label: current.cat, color: "#7a7570" };
                return (
                  <tr style={{ background: "#f7f2eb" }}>
                    <td className="lbl" style={{ fontWeight: 700 }}>
                      {current.name}
                      <span style={{ marginLeft: 6, fontSize: 10, color: "#1c1a18", background: "#e4ddd5", padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: "0.05em" }}>THIS SHOW</span>
                      {onSale(current) && <span style={{ marginLeft: 4, fontSize: 10, color: "#b45309", background: "#fef3c7", padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: "0.05em" }}>{showStatus(current).toUpperCase()}</span>}
                    </td>
                    <td className="lbl">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0, display: "inline-block" }} />
                        {cat.label}
                      </span>
                    </td>
                    <td className="lbl" style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>{current.season}</td>
                    <td style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>{current.open}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{current.cap?.toLocaleString()}</td>
                    <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {currentTix.toLocaleString()}
                      {onSale(current) && currentToday && <span style={{ fontWeight: 400, color: "#7a7570", fontSize: 11, marginLeft: 4 }}>now</span>}
                    </td>
                    <td style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>{currentCapPct}</td>
                    <td style={{ fontWeight: 600, color: projectedFinal ? "#0f766e" : "#7a7570", fontVariantNumeric: "tabular-nums" }}>
                      {projectedFinal ? "~" + projectedPct : projectedPct}
                    </td>
                  </tr>
                );
              })()}
              <tr><td colSpan={8} style={{ padding: 0, borderBottom: "2px solid #e4ddd5" }} /></tr>
              {peers.length === 0 ? (
                <tr><td colSpan={8} style={{ color: "#7a7570", fontSize: 13, padding: "10px 12px" }}>No peers match the current filter selection.</td></tr>
              ) : (
                [...peers].sort((a, b) => b.open.localeCompare(a.open)).map(p => {
                  const sellThrough = p.final && p.cap ? (p.final / p.cap * 100).toFixed(1) + "%" : "—";
                  const cat = CATEGORIES[p.cat] || { label: p.cat, color: "#7a7570" };
                  return (
                    <tr key={p.name}>
                      <td className="lbl" style={{ fontWeight: 500 }}>
                        {p.name}{onSale(p) ? <span style={{ marginLeft: 6, fontSize: 10, color: "#b45309", background: "#fef3c7", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>{showStatus(p).toUpperCase()}</span> : ""}
                      </td>
                      <td className="lbl">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0, display: "inline-block" }} />
                          {cat.label}
                        </span>
                      </td>
                      <td className="lbl" style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>{p.season}</td>
                      <td style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>{p.open}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.cap?.toLocaleString()}</td>
                      <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{p.final?.toLocaleString()}</td>
                      <td style={{ color: "#7a7570", fontVariantNumeric: "tabular-nums" }}>{sellThrough}</td>
                      <td style={{ color: "#bbb1a0", fontVariantNumeric: "tabular-nums" }}>—</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Methodology footnote */}
        <div style={{ padding: 16, background: "#f7f2eb", border: "1px solid #e4ddd5", borderRadius: 6, fontSize: 12, color: "#7a7570", lineHeight: 1.55 }}>
          <div style={{ fontWeight: 600, color: "#1c1a18", marginBottom: 6 }}>How to read this</div>
          <div style={{ marginBottom: 6 }}>
            <strong>Net paid tickets only.</strong> Comps excluded. Refunds netted from cumulative. Subscription bundles with $0 line items excluded; subscribers who allocate seats to specific instances at the per-show price are included.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Peer median</strong>: across selected peer shows, the median cumulative tickets at the same day from opening. <strong>Peer % of final (median)</strong> shows what fraction of their final total peers had sold by that day; useful as a pacing benchmark.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Projected final (calibrated)</strong>: tickets sold so far divided by the median fraction-of-final peers had reached on this day — an extrapolation of how far ahead or behind peer pace the show is running — then scaled by a per-category centering factor, since the raw estimate runs about 15% hot. The range is an 80% confidence interval fitted by leave-one-out backtest over the 46 completed shows, and it narrows as opening approaches: roughly 40–234% of the point estimate at d−30, against 75–142% at d−1. Only shown inside d=−30 where the denominator is stable.
          </div>
          <div>
            <strong>Capacity caveat</strong>: a few recent shows show &gt;100% sell-through against capacity, likely due to seat-hold release patterns not yet reconciled with Spektrix. Use % of capacity as a directional metric.
          </div>
        </div>

        </div>{/* end LEFT COLUMN */}

        {/* RIGHT SIDEBAR */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Ticket Mix */}
          {onSale(current) && (
            <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a7570", fontWeight: 600, marginBottom: 4 }}>Ticket Mix</div>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 600, color: "#1c1a18", marginBottom: 12 }}>{current.name}</div>
              <TicketMixBar showName={current.name} inline />
            </div>
          )}

          {/* Projection Detail */}
          {headline?.projection && projRangeBar && (() => {
            return (
              <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a7570", fontWeight: 600, marginBottom: 4 }}>Projection Detail</div>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 600, color: "#1c1a18", marginBottom: 12 }}>Calibrated forecast</div>
                <div style={{ background: "#f7f2eb", borderRadius: 8, padding: "14px 16px", marginBottom: 12, textAlign: "center" }}>
                  <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: "#1c1a18" }}>~{headline.projection.toLocaleString()}</div>
                  <div style={{ fontSize: 11.5, color: "#0f766e", fontWeight: 600, marginTop: 4 }}>~{projRangeBar.midPct.toFixed(0)}% projected sell-through</div>
                  <div style={{ fontSize: 10.5, color: "#7a7570", marginTop: 1 }}>of {current.cap?.toLocaleString()} capacity</div>
                  <div style={{ position: "relative", height: 6, background: "#e4ddd5", borderRadius: 100, margin: "10px 0 4px", overflow: "visible" }}>
                    <div style={{ position: "absolute", top: 0, left: projRangeBar.fillLeft + "%", width: projRangeBar.fillWidth + "%", height: "100%", background: "linear-gradient(90deg,#6ee7b7,#a7f3d0)", borderRadius: 100 }} />
                    <div style={{ position: "absolute", top: -4, left: projRangeBar.markerLeft + "%", width: 14, height: 14, background: "#0f766e", border: "2.5px solid #fff", borderRadius: "50%", transform: "translateX(-50%)", boxShadow: "0 1px 4px rgba(0,0,0,.12)" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7a7570", marginTop: 4 }}>
                    <span>{projRangeBar.floorPct.toFixed(0)}% floor</span>
                    <span style={{ fontWeight: 600, color: "#0f766e" }}>{projRangeBar.midPct.toFixed(0)}%</span>
                    <span>{projRangeBar.ceilPct.toFixed(0)}% ceiling</span>
                  </div>
                  {headline.lowIsClamped && (
                    <div style={{ fontSize: 10, color: "#a1998f", marginTop: 6, fontStyle: "italic" }}>
                      floor is tickets already sold, not the model&rsquo;s low end
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
                  {[
                    ["Sell-through (80% CI)", `${projRangeBar.floorPct.toFixed(0)}\u2013${projRangeBar.ceilPct.toFixed(0)}%`],
                    ["Pace vs peers", headline.paceIndex
                      ? `${headline.paceIndex.toFixed(2)}\u00d7 ${headline.paceIndex >= 1 ? "ahead" : "behind"}`
                      : "\u2014"],
                    ["Category centering", `\u00d7${headline.centre.toFixed(2)}`],
                    ["Peers used", headline.peerN],
                    ["Current d", headline.d >= 0 ? `+${headline.d}` : headline.d],
                  ].map(([lbl, val]) => (
                    <div key={lbl} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#7a7570" }}>{lbl}</span>
                      <span style={{ fontWeight: 600, color: "#1c1a18" }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Season Context */}
          {(() => {
            const currentSeason = current.season;
            const seasonShows = liveDATA
              .filter(s => s.season === currentSeason && s.cap > 0)
              .sort((a, b) => a.open.localeCompare(b.open));
            if (!seasonShows.length) return null;
            return (
              <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "16px 18px" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a7570", fontWeight: 600, marginBottom: 4 }}>Season Context</div>
                <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 600, color: "#1c1a18", marginBottom: 12 }}>{currentSeason} at a glance</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {seasonShows.map(s => {
                    // The static series stops at the last export, so for a show
                    // that has run since then its last point is not its total.
                    // Prefer the live Spektrix reading wherever we have one.
                    const lastPt = s.series[s.series.length - 1];
                    const live = liveData[s.name];
                    const soldNow = (live?.c > 0) ? live.c : (lastPt?.c ?? 0);
                    const capNow = (live?.cap > 0) ? live.cap : s.cap;
                    const pct = capNow ? (soldNow / capNow * 100) : 0;
                    // A show that has opened but whose series stops before its
                    // opening night has no usable total — the export predates
                    // the run. Finding Nemo read 5% that way, which is its
                    // June figure, not its result. Say nothing rather than that.
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const noTotal = s.open <= todayStr && !(live?.c > 0) && (lastPt?.d ?? 0) < 0;
                    const isCurrent = s.name === currentName;
                    const color = CATEGORIES[s.cat]?.color || "#7a7570";
                    const isUpcoming = s.open > new Date().toISOString().slice(0, 10);
                    return (
                      <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? "#1c1a18" : "#7a7570", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {s.name.length > 22 ? s.name.slice(0, 22) + "\u2026" : s.name}
                            {isCurrent && <span style={{ marginLeft: 4, fontSize: 9, color: "#7a7570", fontWeight: 400 }}>(current)</span>}
                          </div>
                        </div>
                        <div style={{ width: 60, height: 4, background: "#f0ebe4", borderRadius: 100, flexShrink: 0 }}>
                          {!isUpcoming && !noTotal && <div style={{ width: Math.min(pct, 100) + "%", height: "100%", background: color, borderRadius: 100 }} />}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color, width: 36, textAlign: "right", flexShrink: 0 }}>
                          {isUpcoming
                            ? <span style={{ color: "#bbb1a0", fontWeight: 400 }}>soon</span>
                            : noTotal
                              ? <span style={{ color: "#bbb1a0", fontWeight: 400 }} title="No live total available for this show">&mdash;</span>
                              : `${pct.toFixed(0)}%`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        </div>{/* end RIGHT SIDEBAR */}

        </div>{/* end two-column grid */}

      </div>
    </div>
  );
}

function labelForDay(d) {
  if (d === 0) return "Opening night";
  if (d < 0) return `${Math.abs(d)} days before opening`;
  if (d === 7)  return "+7 days (1 week in)";
  if (d === 14) return "+14 days (2 weeks in)";
  if (d === 21) return "+21 days (3 weeks in)";
  return `+${d} days into run`;
}

function StatCard({ accent, label, value, sub, valueColor }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "18px 20px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "12px 12px 0 0", background: accent }} />
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.11em", textTransform: "uppercase", color: "#7a7570", marginBottom: 7 }}>{label}</div>
      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, fontWeight: 700, lineHeight: 1, color: valueColor || "#1c1a18" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "#7a7570", marginTop: 5 }}>{sub}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e4ddd5", borderRadius: 12, padding: "14px 18px" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a7570", marginBottom: 8, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, color = "#1c1a18" }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a7570", marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#7a7570", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 11px", fontSize: 11, borderRadius: 100,
      border: active ? "1px solid #1c1a18" : "1px solid #e4ddd5",
      background: active ? "#1c1a18" : "#ffffff",
      color: active ? "#fffdf9" : "#7a7570", cursor: "pointer",
      fontFamily: "'Inter', sans-serif", fontWeight: 500
    }}>{children}</button>
  );
}

function CatChip({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 11px", fontSize: 11, borderRadius: 100,
      border: active ? `1.5px solid ${color}` : "1px solid #e4ddd5",
      background: active ? "#ffffff" : "#f7f2eb",
      color: active ? "#1c1a18" : "#7a7570", cursor: "pointer", fontWeight: 500,
      fontFamily: "'Inter', sans-serif",
    }}>{children}</button>
  );
}

function Legend({ swatch, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 14, height: 3, background: swatch, display: "inline-block" }} />{label}
    </span>
  );
}

const selectStyle = {
  fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 500, color: "#1c1a18",
  background: "#ffffff", border: "1.5px solid #e4ddd5", borderRadius: 6,
  padding: "7px 30px 7px 11px", appearance: "none",
  backgroundImage: "url('data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%237a7570\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E')",
  backgroundRepeat: "no-repeat", backgroundPosition: "right 9px center", minWidth: 270, cursor: "pointer",
};
