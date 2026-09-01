'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * For the selected show: which performance each ticket was bought for, by the
 * day it was bought.
 *
 * The table above says how full each performance is; the section below says how
 * many tickets the season sold each day. Neither answers where today's sales
 * actually landed — whether the twelve tickets that moved this morning went to
 * this weekend or to the closing Sunday.
 *
 * A matrix, because the quantity is magnitude across two axes: performance down,
 * order date across. Sequential single hue, light to dark, since the value is
 * one measure rather than a set of identities. Counts are printed in the cells
 * as well as encoded, so nothing rests on colour alone.
 */

const RANGES = [7, 14, 30];

// Sequential ramp, one hue, lightness strictly decreasing as the count rises.
const STEPS = [
  { min: 21, bg: '#0f766e', fg: '#ffffff' },
  { min: 11, bg: '#2f9184', fg: '#ffffff' },
  { min: 6,  bg: '#6db8ac', fg: '#14332f' },
  { min: 3,  bg: '#a7d5cd', fg: '#14332f' },
  { min: 1,  bg: '#d5eae6', fg: '#14332f' },
];
const cellStyleFor = (n) => STEPS.find(s => n >= s.min) || { bg: 'transparent', fg: '#cfc8bd' };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { dow: DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], num: d, mon: MON[m - 1] };
}

/** "Thu Sep 3 · 7:00pm" from "2026-09-03 19:00". */
function perfLabel(dt) {
  const [datePart, timePart = ''] = dt.split(' ');
  const { dow, num, mon } = dayLabel(datePart);
  let time = '';
  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    time = `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${hh < 12 ? 'am' : 'pm'}`;
  }
  return { date: `${dow} ${mon} ${num}`, time };
}

export default function InstanceSales({ showName }) {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [withComps, setWithComps] = useState(true);

  useEffect(() => {
    if (!showName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/instance-sales?name=${encodeURIComponent(showName)}&days=${days}&comps=${withComps ? 1 : 0}`)
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
      .catch(e => { if (!cancelled) setError(e?.message || 'request failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [showName, days, withComps]);

  const rows = useMemo(() => {
    if (!data?.performances) return [];
    // A performance that has played can still have taken sales in the window,
    // so keep those; drop only the past ones that saw nothing.
    return data.performances.filter(p => !p.past || p.windowTotal > 0 || showPast);
  }, [data, showPast]);

  const hiddenPast = (data?.performances || []).filter(p => p.past && p.windowTotal === 0).length;

  const card = { background: '#ffffff', border: '1px solid #e4ddd5', borderRadius: 12 };
  const tab = (active) => ({
    fontSize: 11.5, fontWeight: active ? 600 : 400, padding: '4px 11px', borderRadius: 100,
    border: `1px solid ${active ? '#1c1a18' : '#e4ddd5'}`,
    background: active ? '#1c1a18' : '#ffffff', color: active ? '#ffffff' : '#7a7570', cursor: 'pointer',
  });

  if (!showName) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ height: 1, background: '#e4ddd5', marginBottom: 22 }} />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a7570', fontWeight: 600, marginBottom: 4 }}>
            Daily sales by performance
          </div>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 19, fontWeight: 600, color: '#1c1a18' }}>
            {showName}
          </div>
          <div style={{ fontSize: 12, color: '#7a7570', marginTop: 3 }}>
            Which performance each sale was for, by the day it sold.{' '}
            {withComps
              ? 'Every seat, comps included — matching the fill column.'
              : 'Net paid seats only; the fill column still counts comps.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map(d => <button key={d} onClick={() => setDays(d)} style={tab(d === days)}>{d}d</button>)}
          <button
            onClick={() => setWithComps(v => !v)}
            style={{ ...tab(withComps), marginLeft: 6 }}
            title="A comped seat is occupied but unpaid. Counting it matches the fill percentage; excluding it matches the pacing curve."
          >
            comps
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ ...card, padding: 18, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7a7570', fontSize: 12.5 }}>
          Matching orders to performances&hellip;
        </div>
      )}

      {!loading && error && (
        <div style={{ ...card, padding: 18, color: '#92400e', background: '#fffbeb', borderColor: '#fde68a', fontSize: 12.5 }}>
          Per-performance sales unavailable — {error}
        </div>
      )}

      {!loading && !error && data && rows.length === 0 && (
        <div style={{ ...card, padding: 32, color: '#7a7570', fontSize: 12.5, textAlign: 'center' }}>
          No tickets sold for any performance in the last {days} days.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div style={{ ...card, padding: '4px 0', overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a7570', fontWeight: 600, position: 'sticky', left: 0, background: '#ffffff' }}>
                    Performance
                  </th>
                  {data.dates.map((iso, i) => {
                    const { dow, num } = dayLabel(iso);
                    const isToday = i === data.dates.length - 1;
                    return (
                      <th key={iso} style={{
                        padding: '6px 0 8px', minWidth: 30, textAlign: 'center', fontSize: 9.5, lineHeight: 1.25,
                        color: isToday ? '#0f766e' : '#7a7570', fontWeight: isToday ? 700 : 500,
                      }}>
                        <div>{dow}</div><div>{num}</div>
                      </th>
                    );
                  })}
                  <th style={{ padding: '10px 12px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a7570', fontWeight: 600, textAlign: 'right' }}>
                    {days}d
                  </th>
                  <th style={{ padding: '10px 12px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7a7570', fontWeight: 600, textAlign: 'right' }}>
                    Fill
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const { date, time } = perfLabel(p.dt);
                  return (
                    <tr key={p.id}>
                      <td style={{
                        padding: '5px 12px', whiteSpace: 'nowrap', borderTop: '1px solid #f5f1ea',
                        position: 'sticky', left: 0, background: '#ffffff',
                        color: p.past ? '#a8a29a' : '#1c1a18',
                      }}>
                        <span style={{ fontWeight: 600 }}>{date}</span>
                        <span style={{ color: '#7a7570', marginLeft: 6 }}>{time}</span>
                        {p.past && <span style={{ fontSize: 9.5, color: '#a8a29a', marginLeft: 6 }}>played</span>}
                      </td>
                      {p.daily.map((n, i) => {
                        const st = cellStyleFor(n);
                        const { dow, num, mon } = dayLabel(data.dates[i]);
                        return (
                          <td key={data.dates[i]} style={{ padding: 2, borderTop: '1px solid #f5f1ea' }}>
                            <div
                              title={n > 0
                                ? `${n} ticket${n === 1 ? '' : 's'} sold ${dow} ${mon} ${num} for ${date}${time ? ' ' + time : ''}`
                                : `no sales ${dow} ${mon} ${num}`}
                              style={{
                                height: 22, borderRadius: 4, background: st.bg, color: st.fg,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10.5, fontWeight: n > 0 ? 600 : 400, fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {n > 0 ? n : '·'}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 600, borderTop: '1px solid #f5f1ea', fontVariantNumeric: 'tabular-nums' }}>
                        {p.windowTotal || '—'}
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', color: '#7a7570', borderTop: '1px solid #f5f1ea', fontVariantNumeric: 'tabular-nums' }}>
                        {p.cap > 0 ? `${Math.round(p.sold / p.cap * 100)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td style={{ padding: '8px 12px', borderTop: '1px solid #e4ddd5', fontWeight: 600, position: 'sticky', left: 0, background: '#ffffff' }}>
                    All performances
                  </td>
                  {data.dailyTotals.map((n, i) => (
                    <td key={i} style={{ padding: '8px 2px', borderTop: '1px solid #e4ddd5', textAlign: 'center', fontWeight: 600, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>
                      {n || '·'}
                    </td>
                  ))}
                  <td style={{ padding: '8px 12px', borderTop: '1px solid #e4ddd5', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {data.totalInWindow}
                  </td>
                  <td style={{ borderTop: '1px solid #e4ddd5' }} />
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: '#7a7570' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              fewer
              {[...STEPS].reverse().map(s => (
                <span key={s.bg} style={{ width: 16, height: 10, borderRadius: 2, background: s.bg, display: 'inline-block' }} />
              ))}
              more
            </span>
            {hiddenPast > 0 && (
              <button onClick={() => setShowPast(v => !v)} style={{ ...tab(false), fontSize: 11 }}>
                {showPast ? 'Hide' : 'Show'} {hiddenPast} played performance{hiddenPast === 1 ? '' : 's'} with no sales
              </button>
            )}
            {withComps && data.compTickets > 0 && (
              <span>{data.compTickets} of {data.totalInWindow} {data.compTickets === 1 ? 'seat is a comp' : 'seats are comps'}</span>
            )}
            {data.unplaced > 0 && (
              <span>{data.unplaced} ticket{data.unplaced === 1 ? '' : 's'} could not be matched to a performance</span>
            )}
          </div>

          {data.complete === false && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px' }}>
              Some order pages could not be read, so a few days may be undercounted.
            </div>
          )}
        </>
      )}
    </div>
  );
}
