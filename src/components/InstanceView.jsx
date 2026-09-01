'use client';

import SalesActivity from './SalesActivity';

import { useState, useEffect, useMemo, useRef } from 'react';
import { currentShowFromEvents, pacificToday } from '@/lib/showStatus';

const TODAY = pacificToday();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDt(dt) {
  const [datePart, timePart] = dt.split(' ');
  const d = new Date(datePart + 'T' + timePart + ':00');
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return {
    dow: DOW[d.getDay()],
    date: `${MON[d.getMonth()]} ${d.getDate()}`,
    year: d.getFullYear(),
    time: `${h12}:00 ${ampm}`,
    isPast: datePart < TODAY,
  };
}

function fillColor(pct) {
  if (pct > 100) return { bg: '#F3E8FF', bar: '#7C3AED', text: '#5B21B6' };
  if (pct >= 90)  return { bg: '#ECFDF5', bar: '#059669', text: '#065F46' };
  if (pct >= 75)  return { bg: '#F0FDF4', bar: '#16A34A', text: '#14532D' };
  if (pct >= 60)  return { bg: '#FFFBEB', bar: '#D97706', text: '#92400E' };
  if (pct >= 40)  return { bg: '#FFF7ED', bar: '#EA580C', text: '#7C2D12' };
  return             { bg: '#FEF2F2', bar: '#DC2626', text: '#7F1D1D' };
}

function StatCard({ accent, label, value, sub, valueColor }) {
  return (
    <div style={{
      background: '#ffffff', border: '1px solid #e4ddd5', borderRadius: 12,
      padding: '18px 20px 16px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent, borderRadius: '12px 12px 0 0' }} />
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.11em', textTransform: 'uppercase', color: '#7a7570', marginBottom: 7 }}>{label}</div>
      <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 30, fontWeight: 700, lineHeight: 1, color: valueColor || '#1c1a18' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#7a7570', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export default function InstanceView({ initialData = null }) {
  const [shows, setShows] = useState([]);
  // The server pre-render already resolved the current production; until the
  // show list arrives, follow it rather than a hardcoded title.
  const [selectedName, setSelectedName] = useState(initialData?.name ?? '');
  // Once the viewer picks a show themselves, stop overriding their choice.
  const userPicked = useRef(false);
  const [data, setData] = useState(initialData);
  const [loadingShows, setLoadingShows] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoadingShows(true);
    fetch('/api/shows')
      .then((r) => r.json())
      .then((shows) => {
        if (!Array.isArray(shows) || !shows.length) return;
        setShows(shows);
        if (userPicked.current) return;
        const names = shows.map((s) => s.name);
        // Default to the production being marketed right now: of the shows
        // whose run has not ended, the one opening soonest.
        if (!names.includes(selectedName)) {
          setSelectedName(currentShowFromEvents(shows, TODAY) || names[0]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingShows(false));
  }, []);

  useEffect(() => {
    if (!selectedName) return;
    const alreadyHaveData = data?.name?.toLowerCase() === selectedName.toLowerCase();
    if (!alreadyHaveData) { setLoadingData(true); setData(null); }
    setError(null);
    fetch(`/api/instances?name=${encodeURIComponent(selectedName)}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingData(false));
  }, [selectedName]);


  const { past, upcoming } = useMemo(() => {
    const instances = data?.instances || [];
    return {
      past: instances.filter((i) => i.dt.slice(0, 10) < TODAY),
      upcoming: instances.filter((i) => i.dt.slice(0, 10) >= TODAY),
    };
  }, [data]);

  const instances = data?.instances || [];
  const totalSold      = instances.reduce((s, i) => s + i.sold, 0);
  const totalCap       = instances.reduce((s, i) => s + i.cap, 0);
  const overallPct     = totalCap > 0 ? (totalSold / totalCap * 100).toFixed(1) : '0.0';
  const upcomingTotalSold = upcoming.reduce((s, i) => s + i.sold, 0);
  const upcomingTotalCap  = upcoming.reduce((s, i) => s + i.cap, 0);
  const upcomingPct = upcomingTotalCap > 0 ? (upcomingTotalSold / upcomingTotalCap * 100).toFixed(1) : null;

  function InstanceRow({ inst, dim }) {
    const { dow, date, year, time } = fmtDt(inst.dt);
    const colors = fillColor(inst.pct);
    const showYear = year !== new Date().getFullYear();
    return (
      <tr style={{ opacity: dim ? 0.55 : 1 }}>
        <td style={{ color: '#7a7570', fontSize: 12, fontFamily: 'monospace', padding: '9px 12px', borderBottom: '1px solid #f0ebe4' }}>
          <span style={{ display: 'inline-block', width: 32, color: '#bbb1a0' }}>{dow}</span>
          {date}{showYear && <span style={{ color: '#bbb1a0', marginLeft: 4 }}>{year}</span>}
        </td>
        <td style={{ color: '#7a7570', fontSize: 12, fontFamily: 'monospace', padding: '9px 12px', borderBottom: '1px solid #f0ebe4' }}>{time}</td>
        <td style={{ fontWeight: 600, fontFamily: 'monospace', padding: '9px 12px', borderBottom: '1px solid #f0ebe4', color: '#1c1a18' }}>{inst.sold}</td>
        <td style={{ color: '#bbb1a0', fontFamily: 'monospace', padding: '9px 12px', borderBottom: '1px solid #f0ebe4' }}>{inst.cap}</td>
        <td style={{ padding: '9px 12px', borderBottom: '1px solid #f0ebe4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 80, height: 5, background: '#f0ebe4', borderRadius: 100, flexShrink: 0 }}>
              <div style={{ width: Math.min(inst.pct, 100) + '%', height: '100%', background: colors.bar, borderRadius: 100 }} />
            </div>
            <span style={{
              fontSize: 12, fontWeight: 600, color: colors.text, fontFamily: 'monospace',
              background: colors.bg, padding: '2px 7px', borderRadius: 4,
              minWidth: 48, textAlign: 'right', display: 'inline-block',
            }}>
              {inst.pct > 100 ? '>' : ''}{inst.pct.toFixed(0)}%
            </span>
          </div>
        </td>
      </tr>
    );
  }

  function SectionHeader({ label, soldTotal, capTotal, pct }) {
    return (
      <tr>
        <td colSpan={5} style={{
          padding: '7px 12px', fontSize: 10, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#7a7570', fontWeight: 700,
          borderTop: '1px solid #e4ddd5', borderBottom: '1px solid #e4ddd5',
          background: '#f7f2eb', display: 'table-cell',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{label}</span>
            {pct !== null && (
              <span style={{ fontSize: 11, fontWeight: 400, color: '#bbb1a0', textTransform: 'none', letterSpacing: 0, fontFamily: 'monospace' }}>
                {soldTotal} / {capTotal} sold &middot; {pct}%
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  const overallFillColor = fillColor(parseFloat(overallPct));

  return (
    <div style={{ background: '#fffdf9', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif", color: '#1c1a18' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
        body { margin: 0; }
        .iv-outer { max-width: 960px; margin: 0 auto; padding: 32px 40px; }
        .iv-stat-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 20px; }
        @media (max-width: 700px) {
          .iv-outer { padding: 20px 16px !important; }
          .iv-stat-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      <div className="iv-outer">

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7a7570', marginBottom: 5 }}>
            SLO Rep &middot; Marketing Analytics
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 700, color: '#1c1a18', lineHeight: 1.2, margin: '0 0 4px' }}>
            By Performance
          </h1>
          <div style={{ fontSize: 12.5, color: '#7a7570', display: 'flex', alignItems: 'center', gap: 8 }}>
            Tickets sold per instance vs capacity
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: '#22c55e', background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.25)',
              borderRadius: 100, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 5, height: 5, background: '#22c55e', borderRadius: '50%', display: 'inline-block' }} />
              Live
            </span>
          </div>
        </div>

        <div style={{ height: 1, background: '#e4ddd5', marginBottom: 20 }} />

        {/* Show selector */}
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a7570', whiteSpace: 'nowrap' }}>Show</span>
          <select
            value={selectedName}
            onChange={(e) => { userPicked.current = true; setSelectedName(e.target.value); }}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 500, color: '#1c1a18',
              background: '#ffffff', border: '1.5px solid #e4ddd5', borderRadius: 6,
              padding: '7px 30px 7px 11px', appearance: 'none', cursor: 'pointer', minWidth: 270,
            }}
            disabled={loadingShows}
          >
            {loadingShows ? (
              <option>Loading shows&hellip;</option>
            ) : (
              shows.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))
            )}
          </select>
          {loadingData && <span style={{ fontSize: 12, color: '#7a7570' }}>Loading&hellip;</span>}
        </div>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#991B1B' }}>
            {error}
          </div>
        )}

        {/* Stat cards */}
        {data && (
          <div className="iv-stat-grid">
            <StatCard accent="#0f766e" label="Run Total Sold" value={totalSold.toLocaleString()} sub={`of ${totalCap.toLocaleString()} capacity`} />
            <StatCard accent="#b02629" label="Overall Fill" value={overallPct + '%'} sub="all performances" valueColor={overallFillColor.text} />
            <StatCard accent="#d97706" label="Upcoming" value={upcoming.length.toString()} sub={`${upcomingTotalSold} / ${upcomingTotalCap} sold`} />
            <StatCard
              accent="#475569"
              label="Upcoming Fill"
              value={upcomingPct !== null ? upcomingPct + '%' : '—'}
              sub={upcomingPct !== null ? 'avg across remaining' : 'no upcoming performances'}
              valueColor={upcomingPct !== null ? fillColor(parseFloat(upcomingPct)).text : '#bbb1a0'}
            />
          </div>
        )}

        {/* Instance table */}
        {data && (
          <div style={{ background: '#ffffff', border: '1px solid #e4ddd5', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Date', 'Time', 'Sold', 'Cap', 'Fill'].map((h, i) => (
                    <th key={h} style={{
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: '#7a7570', padding: '10px 12px', borderBottom: '1px solid #e4ddd5',
                      textAlign: i >= 2 && i <= 3 ? 'right' : 'left', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcoming.length > 0 && (
                  <>
                    <SectionHeader label="Upcoming performances" soldTotal={upcomingTotalSold} capTotal={upcomingTotalCap} pct={upcomingPct} />
                    {upcoming.map((inst) => <InstanceRow key={inst.dt} inst={inst} dim={false} />)}
                  </>
                )}
                {past.length > 0 && (
                  <>
                    <SectionHeader
                      label="Past performances"
                      soldTotal={past.reduce((s, i) => s + i.sold, 0)}
                      capTotal={past.reduce((s, i) => s + i.cap, 0)}
                      pct={past.reduce((s, i) => s + i.cap, 0) > 0
                        ? (past.reduce((s, i) => s + i.sold, 0) / past.reduce((s, i) => s + i.cap, 0) * 100).toFixed(1)
                        : null}
                    />
                    {[...past].reverse().map((inst) => <InstanceRow key={inst.dt} inst={inst} dim={true} />)}
                  </>
                )}
                {!loadingData && instances.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '16px 12px', color: '#7a7570', fontSize: 13 }}>No performance data found.</td></tr>
                )}
              </tbody>
            </table>

            {/* Color key */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 14px 12px', borderTop: '1px solid #f0ebe4', background: '#f7f2eb' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a7570', alignSelf: 'center' }}>Fill:</span>
              {[
                { label: '>100%', pct: 105 },
                { label: '90–100%', pct: 95 },
                { label: '75–89%', pct: 80 },
                { label: '60–74%', pct: 67 },
                { label: '40–59%', pct: 50 },
                { label: '<40%', pct: 20 },
              ].map(({ label, pct }) => {
                const c = fillColor(pct);
                return (
                  <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: c.bar, display: 'inline-block' }} />
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {!data && !loadingData && !loadingShows && !error && (
          <div style={{ padding: 40, textAlign: 'center', color: '#7a7570' }}>Select a show above to view performance data.</div>
        )}

        {/* Cross-show demand over time. The view above is one show's inventory
            instance by instance; this is the whole season day by day. */}
        <SalesActivity />

      </div>
    </div>
  );
}
