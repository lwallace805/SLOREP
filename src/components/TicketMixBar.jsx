'use client';

import { useState, useEffect } from 'react';

export default function TicketMixBar({ showName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!showName) return;
    setLoading(true);
    setData(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(`/api/ticket-mix?name=${encodeURIComponent(showName)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { clearTimeout(timeout); if (!d.error) setData(d); })
      .catch(() => { clearTimeout(timeout); })
      .finally(() => setLoading(false));
  }, [showName]);

  if (loading) {
    return (
      <div style={{ background: '#FFFFFF', border: '1px solid #E8E2D5', borderRadius: 6, padding: '14px 20px', marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B7E68', fontWeight: 600, marginBottom: 8 }}>
          Ticket Mix
        </div>
        <div style={{ height: 24, background: '#F5F1E8', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
      </div>
    );
  }

  if (!data || !data.total) return null;

  const { total, buckets } = data;

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E8E2D5', borderRadius: 6,
      padding: '14px 20px', marginBottom: 22,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B7E68', fontWeight: 600 }}>
          Ticket Mix
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#6B6052' }}>
          {total.toLocaleString()} total committed seats
        </div>
      </div>

      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 28, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
        {buckets.filter(b => b.count > 0).map((b, i) => (
          <div
            key={b.label}
            title={`${b.label}: ${b.count.toLocaleString()} (${b.pct}%)`}
            style={{
              width: `${b.pct}%`, minWidth: b.count > 0 ? 2 : 0,
              background: b.color, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {b.pct >= 8 && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                color: '#FFFFFF', fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {b.pct.toFixed(0)}%
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
        {buckets.filter(b => b.count > 0).map(b => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: b.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>{b.label}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#6B6052' }}>
              {b.count.toLocaleString()} · {b.pct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: '#BBB1A0', lineHeight: 1.4 }}>
        Subscriber = tickets in orders with a season subscription purchase · Comp = Artist/Sponsor/Volunteer/General comps
      </div>
    </div>
  );
}
