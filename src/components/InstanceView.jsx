'use client';

import { useState, useEffect, useMemo } from 'react';

const TODAY = new Date().toISOString().slice(0, 10);

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

const selectStyle = {
  padding: '7px 10px', fontSize: 13,
  border: '1px solid #D9D2C5', borderRadius: 3,
  background: '#FFFFFF', fontFamily: "'Inter Tight', sans-serif", color: '#1A1A1A',
  minWidth: 280,
};

export default function InstanceView() {
  const [shows, setShows] = useState([]);
  const [selectedName, setSelectedName] = useState('A Grand Night for Singing');
  const [data, setData] = useState(null);
  const [loadingShows, setLoadingShows] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState(null);

  // Load show list once on mount
  useEffect(() => {
    setLoadingShows(true);
    fetch('/api/shows')
      .then((r) => r.json())
      .then((shows) => {
        if (Array.isArray(shows)) {
          setShows(shows);
          // Keep default if in list, otherwise pick first
          const names = shows.map((s) => s.name);
          if (!names.includes(selectedName) && names.length > 0) {
            setSelectedName(names[0]);
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingShows(false));
  }, []);

  // Load instance data whenever selected show changes
  useEffect(() => {
    if (!selectedName) return;
    setLoadingData(true);
    setError(null);

    // Compute saleStart = ~13 months before opening night.
    // firstInstance is the first PERFORMANCE date — tickets typically
    // go on sale 6-18 months earlier, so we look back 400 days.
    const selectedShow = shows.find(s => s.name === selectedName);
    const saleStart = selectedShow?.firstInstance
      ? new Date(new Date(selectedShow.firstInstance).getTime() - 400 * 86400000)
          .toISOString().slice(0, 10)
      : '2025-01-01';

    const params = new URLSearchParams({ name: selectedName, saleStart });
    fetch(`/api/instances?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingData(false));
  }, [selectedName, shows]);

  const { past, upcoming } = useMemo(() => {
    const instances = data?.instances || [];
    return {
      past: instances.filter((i) => i.dt.slice(0, 10) < TODAY),
      upcoming: instances.filter((i) => i.dt.slice(0, 10) >= TODAY),
    };
  }, [data]);

  const instances = data?.instances || [];
  const totalSold = instances.reduce((s, i) => s + i.sold, 0);
  const totalCap  = instances.reduce((s, i) => s + i.cap, 0);
  const overallPct = totalCap > 0 ? (totalSold / totalCap * 100).toFixed(1) : '0.0';
  const upcomingTotalSold = upcoming.reduce((s, i) => s + i.sold, 0);
  const upcomingTotalCap  = upcoming.reduce((s, i) => s + i.cap, 0);
  const upcomingPct = upcomingTotalCap > 0
    ? (upcomingTotalSold / upcomingTotalCap * 100).toFixed(1)
    : null;

  function InstanceRow({ inst, dim }) {
    const { dow, date, year, time } = fmtDt(inst.dt);
    const colors = fillColor(inst.pct);
    const showYear = year !== new Date().getFullYear();
    return (
      <tr style={{ opacity: dim ? 0.55 : 1 }}>
        <td className="lbl mono" style={{ color: '#6B6052', fontSize: 12 }}>
          <span style={{ display: 'inline-block', width: 32, color: '#8B7E68' }}>{dow}</span>
          {date}{showYear && <span style={{ color: '#8B7E68', marginLeft: 4 }}>{year}</span>}
        </td>
        <td className="mono" style={{ color: '#6B6052', fontSize: 12 }}>{time}</td>
        <td className="mono" style={{ fontWeight: 600 }}>{inst.sold}</td>
        <td className="mono" style={{ color: '#8B7E68' }}>{inst.cap}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 80, height: 6, background: '#EBE5D5', borderRadius: 3, flexShrink: 0 }}>
              <div style={{ width: Math.min(inst.pct, 100) + '%', height: '100%', background: colors.bar, borderRadius: 3 }} />
            </div>
            <span className="mono" style={{
              fontSize: 12, fontWeight: 600, color: colors.text,
              background: colors.bg, padding: '1px 6px', borderRadius: 3,
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
          padding: '10px 12px 4px', fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: '#8B7E68', fontWeight: 600,
          borderBottom: '1px solid #D9D2C5', background: '#FAF8F4',
        }}>
          {label}
          {pct !== null && (
            <span className="mono" style={{ float: 'right', fontSize: 11, fontWeight: 400, color: '#6B6052', textTransform: 'none', letterSpacing: 0 }}>
              {soldTotal} / {capTotal} sold · {pct}%
            </span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div style={{ background: '#FAF8F4', minHeight: '100vh', fontFamily: "'Inter Tight', system-ui, sans-serif", color: '#1A1A1A' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body { margin: 0; }
        .serif { font-family: 'Fraunces', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        table.inst { border-collapse: collapse; width: 100%; }
        table.inst th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #8B7E68; font-weight: 600; padding: 8px 12px; text-align: left; border-bottom: 1px solid #D9D2C5; }
        table.inst td { padding: 8px 12px; border-bottom: 1px solid #EBE5D5; font-size: 13px; }
        table.inst td.lbl { text-align: left; }
        table.inst tr:last-child td { border-bottom: none; }
        table.inst tr:hover td { background: #FBF8F0; }
        table.inst tr:has(td[colspan]):hover td { background: #FAF8F4; }
      `}</style>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 40px' }}>

        {/* Header */}
        <div style={{ borderBottom: '1px solid #D9D2C5', paddingBottom: 20, marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8B7E68' }}>
            SLO Rep · Marketing Analytics
          </div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.1, margin: '8px 0 4px' }}>
            By Performance
          </h1>
          <div style={{ fontSize: 14, color: '#6B6052', display: 'flex', alignItems: 'center', gap: 12 }}>
            Tickets sold per instance vs capacity
            <span style={{
              fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
              background: '#ECFDF5', color: '#065F46', padding: '2px 7px', borderRadius: 10,
              fontWeight: 600, border: '1px solid #A7F3D0',
            }}>
              ● LIVE
            </span>
          </div>
        </div>

        {/* Show selector */}
        <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#6B6052', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Show</label>
          <select
            value={selectedName}
            onChange={(e) => setSelectedName(e.target.value)}
            style={selectStyle}
            disabled={loadingShows}
          >
            {loadingShows ? (
              <option>Loading shows…</option>
            ) : (
              shows.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))
            )}
          </select>
          {loadingData && (
            <span style={{ fontSize: 12, color: '#8B7E68' }}>Loading…</span>
          )}
        </div>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '12px 16px', marginBottom: 22, fontSize: 13, color: '#991B1B' }}>
            {error}
          </div>
        )}

        {/* Run summary stats */}
        {data && (
          <div style={{
            background: '#FFFFFF', border: '1px solid #E8E2D5', borderRadius: 6,
            padding: '20px 28px', marginBottom: 22,
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24,
          }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B7E68', marginBottom: 8, fontWeight: 600 }}>Run total sold</div>
              <div className="serif" style={{ fontSize: 28, fontWeight: 600 }}>{totalSold.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#8B7E68', marginTop: 4 }}>of {totalCap.toLocaleString()} capacity</div>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B7E68', marginBottom: 8, fontWeight: 600 }}>Overall fill</div>
              <div className="serif" style={{ fontSize: 28, fontWeight: 600, color: fillColor(parseFloat(overallPct)).text }}>{overallPct}%</div>
              <div style={{ fontSize: 11, color: '#8B7E68', marginTop: 4 }}>all {instances.length} performances</div>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B7E68', marginBottom: 8, fontWeight: 600 }}>Upcoming</div>
              <div className="serif" style={{ fontSize: 28, fontWeight: 600 }}>{upcoming.length}</div>
              <div style={{ fontSize: 11, color: '#8B7E68', marginTop: 4 }}>
                {upcoming.length > 0 ? `${upcomingTotalSold} sold / ${upcomingTotalCap} cap` : 'run complete'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B7E68', marginBottom: 8, fontWeight: 600 }}>Upcoming fill</div>
              {upcomingPct !== null ? (
                <>
                  <div className="serif" style={{ fontSize: 28, fontWeight: 600, color: fillColor(parseFloat(upcomingPct)).text }}>{upcomingPct}%</div>
                  <div style={{ fontSize: 11, color: '#8B7E68', marginTop: 4 }}>avg across remaining shows</div>
                </>
              ) : (
                <>
                  <div className="serif" style={{ fontSize: 28, fontWeight: 600, color: '#BBB1A0' }}>—</div>
                  <div style={{ fontSize: 11, color: '#8B7E68', marginTop: 4 }}>no upcoming performances</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Instance table */}
        {data && (
          <div style={{ background: '#FFFFFF', border: '1px solid #E8E2D5', borderRadius: 6, overflow: 'hidden', marginBottom: 22 }}>
            <table className="inst">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th style={{ textAlign: 'right' }}>Sold</th>
                  <th style={{ textAlign: 'right' }}>Cap</th>
                  <th>Fill</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.length > 0 && (
                  <>
                    <SectionHeader
                      label="Upcoming performances"
                      soldTotal={upcomingTotalSold}
                      capTotal={upcomingTotalCap}
                      pct={upcomingPct}
                    />
                    {upcoming.map((inst) => <InstanceRow key={inst.dt} inst={inst} dim={false} />)}
                  </>
                )}
                {past.length > 0 && (
                  <>
                    <SectionHeader
                      label="Past performances"
                      soldTotal={past.reduce((s, i) => s + i.sold, 0)}
                      capTotal={past.reduce((s, i) => s + i.cap, 0)}
                      pct={
                        past.reduce((s, i) => s + i.cap, 0) > 0
                          ? (past.reduce((s, i) => s + i.sold, 0) / past.reduce((s, i) => s + i.cap, 0) * 100).toFixed(1)
                          : null
                      }
                    />
                    {[...past].reverse().map((inst) => <InstanceRow key={inst.dt} inst={inst} dim={true} />)}
                  </>
                )}
                {!loadingData && instances.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '16px 12px', color: '#8B7E68', fontSize: 13 }}>No performance data found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!data && !loadingData && !loadingShows && !error && (
          <div style={{ padding: 40, textAlign: 'center', color: '#8B7E68' }}>Select a show above to view performance data.</div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6B6052', flexWrap: 'wrap' }}>
          {[
            { label: '>100% sold', ...fillColor(105) },
            { label: '90–100%',   ...fillColor(95) },
            { label: '75–89%',    ...fillColor(80) },
            { label: '60–74%',    ...fillColor(67) },
            { label: '40–59%',    ...fillColor(50) },
            { label: '<40%',      ...fillColor(20) },
          ].map(({ label, bar }) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: bar }} />
              {label}
            </span>
          ))}
        </div>

      </div>
    </div>
  );
}
