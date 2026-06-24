'use client';

import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, ComposedChart
} from "recharts";

import { DATA } from '@/data/pacingData';
import TicketMixBar from './TicketMixBar';

const CATEGORIES = {
  revue:        { label: "Musical Revue",        color: "#D97706" },
  book_musical: { label: "Book Musical",          color: "#0F766E" },
  drama:        { label: "Drama",                 color: "#475569" },
  comedy:       { label: "Comedy",                color: "#B91C1C" },
  holiday:      { label: "Holiday",               color: "#15803D" },
  ubu:          { label: "Ubu's Other Shoe",       color: "#7C3AED" },
};

// Per-category projection calibration derived from backtest of all completed shows.
// bias = how much the raw formula over-predicts on average (positive = inflated).
// mape = mean absolute % error = radius of confidence band.
// drama/comedy use only recent peers (last 2 seasons) due to a structural break
// in audience size between 22-23 and 24-25+ seasons.
const PROJ_CALIBRATION = {
  revue:        { bias: 0.079, mape: 0.086 },
  drama:        { bias: 0.076, mape: 0.446 }, // high mape — structural break
  comedy:       { bias: 0.086, mape: 0.189 },
  book_musical: { bias: 0.160, mape: 0.371 },
  holiday:      { bias: 0.381, mape: 0.524 }, // high mape — small sample
  ubu:          { bias: 0.050, mape: 0.200 }, // Ubu's Other Shoe — small studio, limited data
};

// Recent seasons for drama/comedy weighting (last 2 seasons penalise stale comps)
const RECENT_SEASONS = new Set(["24-25", "25-26"]);

const MILESTONES = [-180, -90, -60, -30, -15, -7, -3, -1, 0, 7, 14, 21];

// Lookup: cumulative at the most recent point at or before day d.
// Returns null if d is past the show's last data point (milestone not reached).
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

export default function PacingDashboard({ initialLiveData = {} }) {
  // Default to Grand Night if present, else most recent in-progress, else most recent overall
  const defaultCurrent = useMemo(() => {
    const gn = DATA.find(s => s.name === "A Grand Night for Singing");
    if (gn) return gn.name;
    const ip = DATA.filter(s => s.inProgress);
    if (ip.length) return ip[ip.length - 1].name;
    return DATA[DATA.length - 1].name;
  }, []);
  const [currentName, setCurrentName] = useState(defaultCurrent);

  // Live Spektrix data: {showName: {d, c}} for in-progress shows.
  // Pre-populated from server-side fetch (initialLiveData) so there is no
  // flash of stale data on first render. The useEffect below refreshes it.
  const [liveData, setLiveData] = useState(initialLiveData);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(
    Object.keys(initialLiveData).length ? new Date() : null
  );

  // Availability total (all committed: Sold + Scanned) for in-progress shows.
  // This is the headline number the user sees; it includes comps and subscriptions.
  const [availTotal, setAvailTotal] = useState(null);

  useEffect(() => {
    const show = DATA.find(s => s.name === currentName);
    if (!show?.inProgress) { setAvailTotal(null); return; }
    fetch(`/api/instances?name=${encodeURIComponent(currentName)}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error && d.instances) {
          const total = d.instances.reduce((s, i) => s + i.sold, 0);
          setAvailTotal(total);
          // Also update liveData so the milestone table shows the correct position
          const [oy, om, od] = show.open.split('-').map(Number);
          const openUtcMs = Date.UTC(oy, om - 1, od);
          const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
          const [ty, tm, td] = todayPacific.split('-').map(Number);
          const todayUtcMs = Date.UTC(ty, tm - 1, td);
          const d = Math.round((todayUtcMs - openUtcMs) / 86400000);
          setLiveData(prev => ({...prev, [currentName]: {d, c: total}}));
          setLiveUpdatedAt(new Date());
        }
      })
      .catch(() => setAvailTotal(null));
  }, [currentName]);

  useEffect(() => {
    // For each in-progress show, fetch live count using delta-from-orders approach.
    // We pass the baseline (last static series point) so the route adds only
    // new sales since that date — matching the movement-report methodology exactly.
    const inProgress = DATA.filter(s => s.inProgress && s.series.length > 0);
    if (!inProgress.length) return;

    Promise.all(inProgress.map(show => {
      const lastPt = show.series[show.series.length - 1];
      // Compute the calendar date of the last series point
      // Use UTC arithmetic to avoid local-timezone shifts
      const [oy, om, od] = show.open.split('-').map(Number);
      const openUtcMs = Date.UTC(oy, om - 1, od);
      const baselineUtcMs = openUtcMs + lastPt.d * 86400000;
      const baseDateStr = new Date(baselineUtcMs).toISOString().slice(0, 10);

      const params = new URLSearchParams({
        name: show.name,
        baselineDate: baseDateStr,
        baselineCount: String(lastPt.c),
        openDate: show.open,
      });
      return fetch(`/api/live-pacing?${params}`)
        .then(r => r.json())
        .then(data => data.error ? null : [show.name, data])
        .catch(() => null);
    })).then(results => {
      const newLive = {};
      results.filter(Boolean).forEach(([name, data]) => { newLive[name] = data; });
      if (Object.keys(newLive).length) {
        setLiveData(prev => {
          const merged = {...prev};
          for (const [name, data] of Object.entries(newLive)) {
            if (!merged[name] || merged[name].c < data.c) {
              merged[name] = data;
            }
          }
          return merged;
        });
        setLiveUpdatedAt(new Date());
      }
    });
  }, []);

  // Merge live data into a show's series for in-progress shows.
  // Uses max(live.c, lastStaticPt.c) so the count never goes backwards,
  // but the d-value always advances to today's position.
  const getLiveSeries = (show) => {
    if (!show.inProgress) return show.series;
    const live = liveData[show.name];
    if (!live || live.c <= 0) return show.series;
    const lastPt = show.series[show.series.length - 1];
    const c = Math.max(live.c, lastPt ? lastPt.c : 0);
    const p = show.cap > 0 ? Math.round(c / show.cap * 1000) / 10 : 0;
    const series = show.series.filter(pt => pt.d < live.d);
    return [...series, { d: live.d, c, p }];
  };

  // Live badge shows whenever we have a valid API response (c > 0)
  const liveApplied = useMemo(() => {
    const applied = {};
    DATA.forEach(show => {
      if (!show.inProgress) return;
      const live = liveData[show.name];
      if (live && live.c > 0) applied[show.name] = true;
    });
    return applied;
  }, [liveData]);

  // Build a version of DATA with live series merged in
  const liveDATA = useMemo(() => DATA.map(show => ({
    ...show,
    series: getLiveSeries(show),
    final: liveApplied[show.name] ? Math.max(liveData[show.name].c, show.final) : show.final,
  })), [liveData, liveApplied]);

  const current = liveDATA.find(s => s.name === currentName) || liveDATA[0];

  const [peerCats, setPeerCats] = useState(new Set([current.cat]));
  const [peerSeasons, setPeerSeasons] = useState(new Set(["22-23", "23-24", "24-25", "25-26", "26-27"]));
  const [excludeInProgress, setExcludeInProgress] = useState(true);

  const peers = useMemo(() => liveDATA.filter(s =>
    s.name !== currentName
    && peerCats.has(s.cat)
    && peerSeasons.has(s.season)
    && (!excludeInProgress || !s.inProgress)
  ), [currentName, peerCats, peerSeasons, excludeInProgress]);

  // Current show position (last data point)
  const currentToday = current.series[current.series.length - 1] || null;

  // Milestone rows
  const milestoneRows = useMemo(() => {
    return MILESTONES.map(d => {
      const cPt = lookupAt(current.series, d);
      const peerData = peers.map(p => {
        const pt = lookupAt(p.series, d);
        return pt ? { tix: pt.c, pct: pt.p, name: p.name, final: p.final, cap: p.cap, capPct: (pt.c / p.cap) * 100 } : null;
      }).filter(Boolean);

      const peerTix = peerData.map(v => v.tix);
      const peerPct = peerData.map(v => v.pct);
      const peerFinals = peerData.map(v => v.final);
      const peerCapPct = peerData.map(v => v.capPct);

      const peerMedTix = median(peerTix);
      const peerMedPct = median(peerPct);
      const peerMedFinal = median(peerFinals);
      const peerMedCapPct = median(peerCapPct);

      // Only show delta/projection when ≥3 peers have data at this milestone.
      // Fewer peers = too noisy to be meaningful (one outlier dominates).
      const MIN_PEERS = 3;
      const delta = (cPt && peerMedTix && peerData.length >= MIN_PEERS)
        ? ((cPt.c - peerMedTix) / peerMedTix) * 100 : null;
      // Only project within 30 days of opening — denominator is too small before that.
      const projection = (cPt && peerMedPct && peerMedPct > 0 && d >= -30 && peerData.length >= MIN_PEERS)
        ? Math.round(cPt.c / (peerMedPct / 100)) : null;

      // Determine if this milestone is "today" for the current show (closest past or current)
      return {
        d,
        currentTix: cPt ? cPt.c : null,
        currentCapPct: cPt && current.cap ? (cPt.c / current.cap) * 100 : null,
        peerMedTix,
        peerMedPct,
        peerMedCapPct,
        peerMin: peerTix.length ? Math.min(...peerTix) : null,
        peerMax: peerTix.length ? Math.max(...peerTix) : null,
        peerN: peerData.length,
        delta,
        projection,
        peerMedFinal,
      };
    });
  }, [current, peers]);

  // Headline numbers: use current position (not a milestone)
  const headline = useMemo(() => {
    if (!currentToday || !peers.length) return null;
    // Walk back from the current show's last day to find the latest d where peers have data
    let d = currentToday.d;
    let peerVals = peers.map(p => lookupAt(p.series, d)).filter(Boolean);
    while (!peerVals.length && d > -400) {
      d--;
      peerVals = peers.map(p => lookupAt(p.series, d)).filter(Boolean);
    }
    if (!peerVals.length) return null;
    const cPt = lookupAt(current.series, d);
    if (!cPt) return null;
    const peerMed = median(peerVals.map(v => v.c));
    const peerMedPct = median(peerVals.map(v => v.p));
    // Require ≥3 peers for delta; require inside d=-30 for projection
    const delta = (peerMed && peerVals.length >= 3) ? ((cPt.c - peerMed) / peerMed) * 100 : null;
    const rawProjection = (peerMedPct && peerMedPct > 0 && d >= -30 && peerVals.length >= 3)
      ? Math.round(cPt.c / (peerMedPct / 100)) : null;

    // Calibrate projection using backtest-derived bias/mape per category
    const cal = PROJ_CALIBRATION[current.cat] || { bias: 0.10, mape: 0.25 };
    const projection = rawProjection ? Math.round(rawProjection / (1 + cal.bias)) : null;
    const projectionLow  = rawProjection ? Math.round(rawProjection / (1 + cal.bias) * (1 - cal.mape)) : null;
    const projectionHigh = rawProjection ? Math.round(rawProjection / (1 + cal.bias) * (1 + cal.mape)) : null;

    const peerMedFinal = median(peers.map(p => p.final));
    return { d, currentTix: cPt.c, peerMed, delta, projection, projectionLow, projectionHigh, peerMedFinal, peerN: peerVals.length };
  }, [currentToday, peers, current]);

  // Chart data: per-day series with current, peer median, peer 25/75 band
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
        row.peerBand = row.peerP75 - row.peerP25; // for stacked area
      }
      out.push(row);
    }
    return out;
  }, [current, peers]);

  const todayD = currentToday ? currentToday.d : null;

  const toggleCat = c => { const n = new Set(peerCats); n.has(c) ? n.delete(c) : n.add(c); setPeerCats(n); };
  const toggleSeason = s => { const n = new Set(peerSeasons); n.has(s) ? n.delete(s) : n.add(s); setPeerSeasons(n); };

  const sortedShows = [...liveDATA].sort((a, b) => b.open.localeCompare(a.open));
  const catColor = CATEGORIES[current.cat]?.color || "#8B7E68";

  // Compute today's date string for past/upcoming labels
  const todayStr = new Date().toISOString().slice(0, 10);
  const showStatus = (s) => {
    if (s.inProgress) return "In Progress";
    if (s.open > todayStr) return "Upcoming";
    return "Past";
  };

  return (
    <div style={{ background: "#FAF8F4", minHeight: "100vh", fontFamily: "'Inter Tight', system-ui, sans-serif", color: "#1A1A1A" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body { margin: 0; }
        .serif { font-family: 'Fraunces', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        table.ms { border-collapse: collapse; width: 100%; }
        table.ms th, table.ms td { padding: 9px 12px; text-align: right; border-bottom: 1px solid #EBE5D5; font-size: 13px; }
        table.ms th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #8B7E68; font-weight: 600; border-bottom: 1px solid #D9D2C5; text-align: right; vertical-align: bottom; }
        table.ms td.lbl, table.ms th.lbl { text-align: left; }
        table.ms tr.future td { color: #BBB1A0; }
        table.ms tr.future td.lbl { color: #8B7E68; }
        table.ms tr.now td { background: #FBF1E0; border-bottom-color: #E8D7B5; }
        table.ms tr.now td.lbl { color: #6B4F1D; font-weight: 600; }
        table.ms tr:not(.now):not(.future):hover td { background: #FBF8F0; }
      `}</style>

      <div style={{ maxWidth: 1340, margin: "0 auto", padding: "32px 40px" }}>
        {/* Header */}
        <div style={{ borderBottom: "1px solid #D9D2C5", paddingBottom: 20, marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "#8B7E68" }}>
            SLO Rep · Marketing Analytics
          </div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.1, margin: "8px 0 4px" }}>
            How is this show pacing?
          </h1>
          <div style={{ fontSize: 14, color: "#6B6052" }}>
            Net single-ticket sales vs peer median at key milestones before and into the run
          </div>
        </div>

        {/* Selectors */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
          <Panel title="This show">
            <select value={currentName} onChange={e => { const s = liveDATA.find(x => x.name === e.target.value); setCurrentName(e.target.value); setPeerCats(new Set([s.cat])); }} style={selectStyle}>
              {sortedShows.map(s => (
                <option key={s.name} value={s.name}>
                  {s.name} · {s.season} · {CATEGORIES[s.cat]?.label || s.cat} · {showStatus(s)}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6B6052" }}>
              <span className="mono">Opens {current.open}</span>
              {currentToday !== null && (
                <span> · <span className="mono">{currentToday.d <= 0 ? `${Math.abs(currentToday.d)}d out` : `+${currentToday.d}d`}</span> today · {current.cap?.toLocaleString()} capacity</span>
              )}
              {current.inProgress && liveApplied[current.name] && (
                <span style={{ marginLeft: 8 }}>
                  <span style={{ fontSize: 10, background: "#ECFDF5", color: "#065F46", padding: "1px 6px", borderRadius: 10, fontWeight: 600, border: "1px solid #A7F3D0", letterSpacing: "0.04em" }}>
                    ● LIVE
                  </span>
                  {liveUpdatedAt && (
                    <span style={{ marginLeft: 6, color: "#8B7E68" }}>
                      updated {liveUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </span>
              )}
            </div>
          </Panel>

          <Panel title="Compare against">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <CatChip key={k} active={peerCats.has(k)} color={v.color} onClick={() => toggleCat(k)}>{v.label}</CatChip>
              ))}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              {["22-23", "23-24", "24-25", "25-26", "26-27"].map(s => (
                <Chip key={s} active={peerSeasons.has(s)} onClick={() => toggleSeason(s)}>{s}</Chip>
              ))}
              <label style={{ marginLeft: 8, fontSize: 11, color: "#6B6052", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={excludeInProgress} onChange={e => setExcludeInProgress(e.target.checked)} />
                exclude in-progress
              </label>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#6B6052" }}>
              <span className="mono">{peers.length}</span> peer show{peers.length === 1 ? "" : "s"} in selection
            </div>
          </Panel>
        </div>

        {/* Hero stats */}
        {headline && (
          <div style={{
            background: "#FFFFFF", border: "1px solid #E8E2D5", borderRadius: 6,
            padding: "24px 28px", marginBottom: 22,
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32
          }}>
            <Stat
              label={`Right now (${headline.d <= 0 ? Math.abs(headline.d) + "d out" : "+" + headline.d + "d into run"})`}
              value={(availTotal ?? headline.currentTix).toLocaleString()}
              sub={`${((availTotal ?? headline.currentTix) / current.cap * 100).toFixed(1)}% of capacity`}
            />
            <Stat
              label={`Peer median at ${headline.d <= 0 ? Math.abs(headline.d) + "d out" : "+" + headline.d + "d"}`}
              value={headline.peerMed != null ? Math.round(headline.peerMed).toLocaleString() : "—"}
              sub={`across ${headline.peerN} peers`}
            />
            <Stat
              label="Vs median pace"
              value={headline.delta != null ? (headline.delta > 0 ? "+" : "") + headline.delta.toFixed(1) + "%" : "—"}
              sub={headline.delta != null ? (headline.delta > 5 ? "ahead of pace" : headline.delta < -5 ? "behind pace" : "on pace") : `need ≥3 peers (${headline.peerN} now)`}
              color={headline.delta != null ? (headline.delta > 5 ? "#0F766E" : headline.delta < -5 ? "#B91C1C" : "#475569") : "#BBB1A0"}
            />
            <Stat
              label="Projected final (calibrated)"
              value={
                headline.projection
                  ? `~${headline.projection.toLocaleString()}`
                  : headline.d < -30 ? "too early" : "—"
              }
              sub={
                headline.projection && headline.projectionLow && headline.projectionHigh && current.cap
                  ? `range ${(headline.projectionLow/current.cap*100).toFixed(0)}–${Math.min(100,(headline.projectionHigh/current.cap*100)).toFixed(0)}% sell-through`
                  : `peer median final: ${headline.peerMedFinal ? Math.round(headline.peerMedFinal).toLocaleString() : "—"}`
              }
            />
          </div>
        )}

        {/* Ticket mix bar — shown for in-progress shows */}
        {current.inProgress && <TicketMixBar showName={current.name} />}

        {/* Milestone table */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8E2D5", borderRadius: 6, padding: "8px 20px 20px", marginBottom: 22 }}>
          <div style={{ padding: "14px 0 10px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8B7E68" }}>
              Milestone comparison
            </div>
            <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {currentName} <span style={{ color: "#8B7E68", fontWeight: 400 }}>vs {peers.length} peer{peers.length === 1 ? "" : "s"}</span>
            </div>
          </div>

          <table className="ms">
            <thead>
              <tr>
                <th className="lbl">Days from opening</th>
                <th>This show<br/><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#BBB1A0" }}>tickets</span></th>
                <th>% of capacity</th>
                <th>Peer median<br/><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#BBB1A0" }}>tickets</span></th>
                <th>Peer % of final<br/><span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#BBB1A0" }}>median</span></th>
                <th>Δ vs peer median</th>
                <th>Peer range</th>
              </tr>
            </thead>
            <tbody>
              {milestoneRows.map((r, ri) => {
                // Find the "now" milestone — closest milestone before todayD, only if currentTix at later milestones is null
                const isFuture = r.currentTix === null && todayD !== null && todayD < r.d;
                const lastReachedMs = [...milestoneRows].filter(x => x.currentTix !== null).pop();
                const isNow = current.inProgress && r === lastReachedMs;
                const lowConfidence = r.peerN < 3 && !isFuture;
                // Insert a divider row between opening night (d=0) and post-opening milestones
                const divider = r.d === 7 ? (
                  <tr key="divider-opening">
                    <td colSpan={7} style={{ padding: "0", borderBottom: "2px solid #D9D2C5", borderTop: "2px solid #D9D2C5" }}>
                      <div style={{ padding: "5px 12px", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8B7E68", fontWeight: 600, background: "#F5F1E8" }}>
                        Post-opening · into the run ↓
                      </div>
                    </td>
                  </tr>
                ) : null;
                return (
                  <React.Fragment key={r.d}>
                    {divider}
                    <tr className={isFuture ? "future" : isNow ? "now" : ""} style={{ opacity: lowConfidence ? 0.6 : 1 }}>
                    <td className="lbl mono">
                      {labelForDay(r.d)}{isNow ? " · today" : ""}
                      {lowConfidence && <span title={`Only ${r.peerN} peer${r.peerN === 1 ? '' : 's'} at this milestone`} style={{ marginLeft: 6, fontSize: 10, color: "#B45309", background: "#FEF3C7", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>low n</span>}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {isNow && currentToday ? currentToday.c.toLocaleString() : (r.currentTix !== null ? r.currentTix.toLocaleString() : "—")}
                    </td>
                    <td className="mono" style={{ color: "#6B6052" }}>
                      {isNow && currentToday ? (currentToday.c / current.cap * 100).toFixed(1) + "%" : (r.currentCapPct !== null ? r.currentCapPct.toFixed(1) + "%" : "—")}
                    </td>
                    <td className="mono">{r.peerMedTix !== null ? Math.round(r.peerMedTix).toLocaleString() : "—"}</td>
                    <td className="mono" style={{ color: "#6B6052" }}>
                      {r.peerMedPct !== null ? r.peerMedPct.toFixed(1) + "%" : "—"}
                    </td>
                    <td className="mono" style={{
                      fontWeight: 600,
                      color: r.delta === null ? "#BBB1A0"
                        : r.delta > 5 ? "#0F766E"
                        : r.delta < -5 ? "#B91C1C" : "#475569"
                    }}>
                      {r.delta !== null ? (r.delta > 0 ? "+" : "") + r.delta.toFixed(1) + "%" : "—"}
                    </td>
                    <td className="mono" style={{ color: "#8B7E68", fontSize: 12 }}>
                      {r.peerMin !== null ? `${Math.round(r.peerMin).toLocaleString()}–${Math.round(r.peerMax).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 12, fontSize: 11, color: "#8B7E68", lineHeight: 1.5 }}>
            <strong style={{ color: "#6B4F1D" }}>Caveat:</strong> Early milestones (−180, −90, −60) are dominated by subscriber seat allocations that happen when the season goes on sale.
            Single-ticket marketing response shows up clearest from −60 days in.
          </div>
        </div>

        {/* Chart */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8E2D5", borderRadius: 6, padding: "20px 16px 12px", marginBottom: 22 }}>
          <div style={{ padding: "0 8px 12px", borderBottom: "1px solid #F0EAD8", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8B7E68" }}>
                Pacing curve
              </div>
              <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                {currentName} vs peer median + 25–75th percentile band
              </div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "#8B7E68", display: "flex", gap: 14 }}>
              <Legend swatch="#1A1A1A" label="this show" />
              <Legend swatch={catColor} label="peer median" />
              <Legend swatch={catColor + "33"} label="25–75% range" />
            </div>
          </div>

          <div style={{ height: 380, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 12, right: 24, bottom: 28, left: 12 }}>
                <CartesianGrid stroke="#F0EAD8" strokeDasharray="3 3" />
                <XAxis dataKey="d" type="number" domain={[-120, 28]}
                  tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fill: "#6B6052" }}
                  tickFormatter={v => v === 0 ? "open" : (v > 0 ? `+${v}d` : `${v}d`)}
                  stroke="#C8BFAC" />
                <YAxis tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fill: "#6B6052" }}
                  stroke="#C8BFAC" />
                <Tooltip
                  contentStyle={{ background: "#FFFFFF", border: "1px solid #D9D2C5", borderRadius: 3, fontSize: 12 }}
                  labelFormatter={d => `${d > 0 ? "+" : ""}${d}d from opening`}
                  formatter={(v, n) => {
                    if (v == null) return ["—", n];
                    const labels = { current: currentName, peerMed: "Peer median", peerP25: "25th pct", peerP75: "75th pct", peerBand: "75th pct" };
                    return [Math.round(v).toLocaleString(), labels[n] || n];
                  }}
                />
                {MILESTONES.map(d => (
                  <ReferenceLine key={d} x={d} stroke="#E8E2D5" strokeDasharray="2 4" />
                ))}
                <ReferenceLine x={0} stroke="#1A1A1A" strokeWidth={1.2} label={{ value: "Opening", position: "top", fontSize: 10, fill: "#1A1A1A" }} />
                {todayD !== null && current.inProgress && (
                  <ReferenceLine x={todayD} stroke="#6B4F1D" strokeWidth={1.2} strokeDasharray="4 2"
                    label={{ value: "Today", position: "top", fontSize: 10, fill: "#6B4F1D" }} />
                )}
                {/* Band: stacked area trick — P25 transparent + band */}
                <Area type="monotone" dataKey="peerP25" stackId="band" stroke="none" fill="transparent" />
                <Area type="monotone" dataKey="peerBand" stackId="band" stroke="none" fill={catColor} fillOpacity={0.15} />
                <Line type="monotone" dataKey="peerMed" stroke={catColor} strokeWidth={2.2} dot={false} connectNulls />
                <Line type="monotone" dataKey="current" stroke="#1A1A1A" strokeWidth={3} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Peer list */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E8E2D5", borderRadius: 6, padding: "8px 20px 20px", marginBottom: 22 }}>
          <div style={{ padding: "14px 0 10px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8B7E68" }}>
              Peer reference
            </div>
            <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
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
              {/* Current show row */}
              {(() => {
                const currentTix = availTotal ?? (currentToday ? currentToday.c : current.final);
                const currentCapPct = current.cap ? (currentTix / current.cap * 100).toFixed(1) + "%" : "—";
                const projectedFinal = headline && headline.projection ? headline.projection : null;
                const projLow = headline?.projectionLow;
                const projHigh = headline?.projectionHigh;
                // Show calibrated range when available, else point or actual
                const projectedPct = projectedFinal && current.cap
                  ? (projLow && projHigh
                      ? `${(projLow/current.cap*100).toFixed(0)}–${Math.min(100,(projHigh/current.cap*100)).toFixed(0)}%`
                      : (projectedFinal/current.cap*100).toFixed(1)+"%")
                  : current.inProgress ? "—" : (current.final && current.cap ? (current.final/current.cap*100).toFixed(1)+"%" : "—");
                const cat = CATEGORIES[current.cat] || { label: current.cat, color: "#8B7E68" };
                return (
                  <tr style={{ background: "#F5F1E8" }}>
                    <td className="lbl" style={{ fontWeight: 700 }}>
                      {current.name}
                      <span style={{ marginLeft: 6, fontSize: 10, color: "#1A1A1A", background: "#D9D2C5", padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: "0.05em" }}>THIS SHOW</span>
                      {current.inProgress && <span style={{ marginLeft: 4, fontSize: 10, color: "#B45309", background: "#FEF3C7", padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: "0.05em" }}>IN PROGRESS</span>}
                    </td>
                    <td className="lbl">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
                        {cat.label}
                      </span>
                    </td>
                    <td className="lbl mono" style={{ color: "#6B6052" }}>{current.season}</td>
                    <td className="mono" style={{ color: "#6B6052" }}>{current.open}</td>
                    <td className="mono">{current.cap?.toLocaleString()}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {currentTix.toLocaleString()}
                      {current.inProgress && currentToday && <span style={{ fontWeight: 400, color: "#8B7E68", fontSize: 11, marginLeft: 4 }}>now</span>}
                    </td>
                    <td className="mono" style={{ color: "#6B6052" }}>{currentCapPct}</td>
                    <td className="mono" style={{ fontWeight: 600, color: projectedFinal ? "#0F766E" : "#6B6052" }}>
                      {projectedFinal ? "~" + projectedPct : projectedPct}
                    </td>
                  </tr>
                );
              })()}
              {/* Divider */}
              <tr><td colSpan={8} style={{ padding: 0, borderBottom: "2px solid #D9D2C5" }} /></tr>
              {/* Peer rows */}
              {peers.length === 0 ? (
                <tr><td colSpan={8} style={{ color: "#8B7E68", fontSize: 13, padding: "10px 12px" }}>No peers match the current filter selection.</td></tr>
              ) : (
                [...peers].sort((a, b) => b.open.localeCompare(a.open)).map(p => {
                  const sellThrough = p.final && p.cap ? (p.final / p.cap * 100).toFixed(1) + "%" : "—";
                  const cat = CATEGORIES[p.cat] || { label: p.cat, color: "#8B7E68" };
                  return (
                    <tr key={p.name}>
                      <td className="lbl" style={{ fontWeight: 500 }}>{p.name}{p.inProgress ? <span style={{ marginLeft: 6, fontSize: 10, color: "#B45309", background: "#FEF3C7", padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: "0.05em" }}>IN PROGRESS</span> : ""}</td>
                      <td className="lbl">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
                          {cat.label}
                        </span>
                      </td>
                      <td className="lbl mono" style={{ color: "#6B6052" }}>{p.season}</td>
                      <td className="mono" style={{ color: "#6B6052" }}>{p.open}</td>
                      <td className="mono">{p.cap?.toLocaleString()}</td>
                      <td className="mono" style={{ fontWeight: 600 }}>{p.final?.toLocaleString()}</td>
                      <td className="mono" style={{ color: "#6B6052" }}>{sellThrough}</td>
                      <td className="mono" style={{ color: "#BBB1A0" }}>—</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Methodology */}
        <div style={{ padding: 16, background: "#F5F1E8", border: "1px solid #E8E2D5", borderRadius: 4, fontSize: 12, color: "#6B6052", lineHeight: 1.55 }}>
          <div style={{ fontWeight: 600, color: "#1A1A1A", marginBottom: 6 }}>How to read this</div>
          <div style={{ marginBottom: 6 }}>
            <strong>Net paid tickets only.</strong> Comps excluded. Refunds netted from cumulative (a ticket sold and later refunded counts as zero, not +1 then +1 again). Subscription bundles with $0 line items excluded; but subscribers who allocate their seats to specific instances at the per-show price are included in the counts.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Peer median</strong>: across selected peer shows, the median cumulative tickets at the same day from opening. <strong>Peer % of final (median)</strong> shows what fraction of their final total peers had typically sold by that day; useful as a pacing benchmark.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>Projected final (calibrated)</strong>: raw projection (current ÷ peer median % of final) adjusted for systematic over-prediction bias measured in a backtest of all completed shows. The range reflects ±1 mean-absolute-error for the category. Only shown inside d=−30 where the denominator is stable enough to be meaningful. Revue shows have the tightest historical error (~8.6% MAPE); drama/comedy have wider error due to audience growth between seasons.
          </div>
          <div>
            <strong>Capacity caveat</strong>: a few recent shows show &gt;100% sell-through against capacity. Likely due to seat-hold release patterns we haven't reconciled with Spektrix yet. Use % of capacity as a directional metric, not an exact one.
          </div>
        </div>

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

function Panel({ title, children }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E8E2D5", borderRadius: 6, padding: "14px 18px" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8B7E68", marginBottom: 8, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, color = "#1A1A1A" }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8B7E68", marginBottom: 8, fontWeight: 600 }}>{label}</div>
      <div className="serif" style={{ fontSize: 30, fontWeight: 600, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8B7E68", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 9px", fontSize: 11, borderRadius: 3,
      border: active ? "1px solid #1A1A1A" : "1px solid #D9D2C5",
      background: active ? "#1A1A1A" : "#FFFFFF",
      color: active ? "#FAF8F4" : "#6B6052", cursor: "pointer",
      fontFamily: "'JetBrains Mono', monospace", fontWeight: 500
    }}>{children}</button>
  );
}

function CatChip({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 10px", fontSize: 12, borderRadius: 3,
      border: active ? `1px solid ${color}` : "1px solid #D9D2C5",
      borderLeft: `4px solid ${color}`,
      background: active ? "#FFFFFF" : "#F5F1E8",
      color: active ? "#1A1A1A" : "#8B7E68", cursor: "pointer", fontWeight: 500
    }}>{children}</button>
  );
}

function Legend({ swatch, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 14, height: 3, background: swatch }} />{label}
    </span>
  );
}

const selectStyle = {
  width: "100%", padding: "7px 10px", fontSize: 13,
  border: "1px solid #D9D2C5", borderRadius: 3,
  background: "#FFFFFF", fontFamily: "'Inter Tight', sans-serif", color: "#1A1A1A"
};
