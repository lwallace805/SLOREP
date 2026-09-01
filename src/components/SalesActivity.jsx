'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

/**
 * Net paid tickets sold per day, stacked by show.
 *
 * The pacing page answers "how is one show tracking against its peers". This
 * answers the other question: across the season, where are new sales landing
 * this week, and which shows are moving.
 */

const SURFACE = '#fffdf9';

// Categorical slots in fixed order, never cycled — validated against this
// page's surface (worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6). Three of
// them sit under 3:1 contrast, so the table below is not optional: it is the
// relief that keeps identity readable without relying on colour.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#a8a29a';
const MAX_SERIES = SERIES.length;

const RANGES = [7, 30, 90];

function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${d}`;
}

function TooltipBody({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter(p => p.value > 0).slice().reverse();
  const total = payload.reduce((n, p) => n + (p.value || 0), 0);
  return (
    <div style={{
      background: '#ffffff', border: '1px solid #e4ddd5', borderRadius: 8,
      padding: '9px 11px', fontSize: 12, boxShadow: '0 2px 10px rgba(0,0,0,.08)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#1c1a18' }}>{shortDate(label)}</div>
      {rows.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.fill, flexShrink: 0 }} />
          <span style={{ color: '#7a7570', flex: 1, whiteSpace: 'nowrap' }}>{p.dataKey}</span>
          <span style={{ fontWeight: 600, color: '#1c1a18' }}>{p.value}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid #f0ebe4', marginTop: 5, paddingTop: 5, display: 'flex', justifyContent: 'space-between', gap: 14 }}>
        <span style={{ color: '#7a7570' }}>total</span>
        <span style={{ fontWeight: 600 }}>{total}</span>
      </div>
    </div>
  );
}

export default function SalesActivity() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [withComps, setWithComps] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sales-activity?days=${days}&comps=${withComps ? 1 : 0}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !body || body.error) {
          setError(body?.error || `http ${r.status}`);
          setData(null);
          return;
        }
        setData(body);
      })
      .catch(err => { if (!cancelled) setError(err?.message || 'request failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, withComps]);

  // Top shows keep their own colour; the tail folds into one "Other" band
  // rather than inventing a ninth hue.
  const { rows, chart, named, hasOther } = useMemo(() => {
    if (!data?.shows?.length) return { rows: [], chart: [], named: [], hasOther: false };
    const ranked = [...data.shows].sort((a, b) => b.total - a.total);
    const top = ranked.slice(0, MAX_SERIES);
    const tail = ranked.slice(MAX_SERIES);
    const chartRows = data.dates.map((date, i) => {
      const row = { date };
      for (const s of top) row[s.name] = s.daily[i];
      if (tail.length) row.Other = tail.reduce((n, s) => n + s.daily[i], 0);
      return row;
    });
    return {
      rows: [...data.shows].sort((a, b) => b.last7 - a.last7 || b.total - a.total),
      chart: chartRows,
      named: top.map((s, i) => ({ name: s.name, color: SERIES[i] })),
      hasOther: tail.length > 0,
    };
  }, [data]);

  const colorFor = (name) => named.find(n => n.name === name)?.color || OTHER;
  const windowTotal = rows.reduce((n, s) => n + s.total, 0);

  const card = { background: '#ffffff', border: '1px solid #e4ddd5', borderRadius: 12, padding: '18px 20px' };
  const tab = (active) => ({
    fontSize: 11.5, fontWeight: active ? 600 : 400, padding: '4px 11px', borderRadius: 100,
    border: `1px solid ${active ? '#1c1a18' : '#e4ddd5'}`,
    background: active ? '#1c1a18' : '#ffffff', color: active ? '#ffffff' : '#7a7570', cursor: 'pointer',
  });

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ height: 1, background: '#e4ddd5', marginBottom: 22 }} />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7570', fontWeight: 600, marginBottom: 4 }}>
            Sales Activity
          </div>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 19, fontWeight: 600, color: '#1c1a18' }}>
            Where new sales are landing
          </div>
          <div style={{ fontSize: 12, color: '#7a7570', marginTop: 3 }}>
            Seats by order date, stacked by show.{' '}
            {withComps ? 'Comps included.' : 'Net paid only — comps and $0 subscription lines excluded.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map(d => (
            <button key={d} onClick={() => setDays(d)} style={tab(d === days)}>{d}d</button>
          ))}
          <button onClick={() => setWithComps(v => !v)} style={{ ...tab(withComps), marginLeft: 6 }}
            title="A comped seat is occupied but unpaid.">comps</button>
        </div>
      </div>

      {loading && (
        <div style={{ ...card, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7a7570', fontSize: 12.5 }}>
          Counting orders across the last {days} days&hellip;
        </div>
      )}

      {!loading && error && (
        <div style={{ ...card, color: '#92400e', background: '#fffbeb', borderColor: '#fde68a', fontSize: 12.5 }}>
          Sales activity unavailable — {error}
        </div>
      )}

      {!loading && !error && data && rows.length === 0 && (
        <div style={{ ...card, color: '#7a7570', fontSize: 12.5, textAlign: 'center', padding: 32 }}>
          No paid tickets recorded in the last {days} days.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, color: '#7a7570' }}>
                <strong style={{ color: '#1c1a18', fontWeight: 600 }}>{windowTotal.toLocaleString()}</strong> seats over {days} days
                {withComps && data.compTickets > 0 && <span>, {data.compTickets.toLocaleString()} of them comps</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: '#7a7570' }}>
                {named.map(n => (
                  <span key={n.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: n.color }} />
                    {n.name.length > 26 ? n.name.slice(0, 26) + '…' : n.name}
                  </span>
                ))}
                {hasOther && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: OTHER }} />Other
                  </span>
                )}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={chart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap={days > 30 ? 1 : 2}>
                <CartesianGrid stroke="#f0ebe4" vertical={false} />
                <XAxis
                  dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={{ stroke: '#e4ddd5' }}
                  tick={{ fontSize: 10, fill: '#7a7570' }} minTickGap={26}
                />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#7a7570' }} width={44} />
                <Tooltip content={<TooltipBody />} cursor={{ fill: 'rgba(28,26,24,.05)' }} />
                {named.map((n, i) => (
                  <Bar
                    key={n.name} dataKey={n.name} stackId="s" fill={n.color}
                    stroke={SURFACE} strokeWidth={1}
                    radius={i === named.length - 1 && !hasOther ? [3, 3, 0, 0] : 0}
                  />
                ))}
                {hasOther && <Bar dataKey="Other" stackId="s" fill={OTHER} stroke={SURFACE} strokeWidth={1} radius={[3, 3, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ ...card, marginTop: 14, padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#faf7f2' }}>
                  {['Show', 'Last 7d', 'Last 30d', `${days}d total`].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i === 0 ? 'left' : 'right', padding: '9px 14px',
                      fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: '#7a7570', fontWeight: 600, borderBottom: '1px solid #e4ddd5',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.eventId}>
                    <td style={{ padding: '9px 14px', borderBottom: '1px solid #f0ebe4' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: colorFor(s.name), flexShrink: 0 }} />
                        {s.name}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #f0ebe4' }}>
                      {s.last7.toLocaleString()}
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#4a4642', borderBottom: '1px solid #f0ebe4' }}>
                      {s.last30.toLocaleString()}
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#4a4642', borderBottom: '1px solid #f0ebe4' }}>
                      {s.total.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.complete === false && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px' }}>
              Some order pages could not be read, so a few days may be undercounted. Directional, not a ledger.
            </div>
          )}
        </>
      )}
    </div>
  );
}
