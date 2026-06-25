import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SLO Rep Analytics · Redesign Mockup</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --crimson:#b02629;--crimson-dk:#8a1c1f;
  --ink:#1c1a18;--body:#3d3a36;--muted:#7a7570;
  --hairline:#e4ddd5;--hairline-soft:#f0ebe4;
  --canvas:#fffdf9;--surface:#f7f2eb;--card:#ffffff;
  --teal:#0f766e;--teal-lt:#ccfbf1;
  --amber:#d97706;--amber-lt:#fef3c7;
  --slate:#475569;--sand:#bbb1a0;
  --green:#16a34a;--red:#dc2626;
  --r-sm:6px;--r-md:12px;--r-lg:20px;
}
html{font-size:16px}
body{font-family:'Inter',system-ui,sans-serif;background:var(--canvas);color:var(--ink);line-height:1.5}
/* NAV */
.nav{background:var(--ink);display:flex;align-items:center;padding:0 40px;height:56px;position:sticky;top:0;z-index:200;border-bottom:1px solid #2d2a26;gap:0}
.nav-logo{font-family:'Playfair Display',Georgia,serif;font-size:14px;font-weight:600;color:#fff;letter-spacing:.07em;text-transform:uppercase;margin-right:32px;padding-right:32px;border-right:1px solid #3a3632;white-space:nowrap;display:flex;align-items:center;gap:7px}
.logo-dot{width:7px;height:7px;background:var(--crimson);border-radius:50%;display:inline-block}
.nav-links{display:flex;gap:0}
.nav-link{font-size:12.5px;font-weight:500;color:#a09890;padding:0 14px;line-height:56px;border-bottom:2px solid transparent;cursor:pointer;transition:color .15s;white-space:nowrap}
.nav-link.active{color:#fff;border-bottom-color:var(--crimson)}
.nav-link:hover:not(.active){color:#d0c8be}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.live-badge{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#22c55e;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);border-radius:100px;padding:3px 9px;display:flex;align-items:center;gap:5px}
.live-badge::before{content:'';width:5px;height:5px;background:#22c55e;border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
/* MOCKUP SWITCHER */
.switcher{background:#111;display:flex;align-items:center;gap:10px;padding:8px 40px;border-bottom:1px solid #222;font-size:11px;color:#666}
.sw-btn{font:600 10px/1 inherit;letter-spacing:.07em;text-transform:uppercase;color:#fff;background:transparent;border:1px solid #333;border-radius:100px;padding:5px 13px;cursor:pointer;transition:background .15s}
.sw-btn.on{background:var(--crimson);border-color:var(--crimson)}
/* PAGE */
.pg{display:none}.pg.active{display:block}
/* HEADER */
.hdr{padding:32px 40px 0;max-width:1260px;width:100%;margin:0 auto}
.supertitle{font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.page-title{font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:700;color:var(--ink);line-height:1.2}
.page-meta{font-size:12.5px;color:var(--muted);margin-top:4px;display:flex;align-items:center;gap:6px}
.divider{height:1px;background:var(--hairline);margin:22px 40px 0;max-width:1180px}
/* SHOW SELECTOR */
.sel-row{padding:16px 40px 0;max-width:1260px;width:100%;margin:0 auto;display:flex;align-items:center;gap:12px}
.sel-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.show-sel{font-family:inherit;font-size:13.5px;font-weight:500;color:var(--ink);background:var(--card);border:1.5px solid var(--hairline);border-radius:var(--r-sm);padding:7px 30px 7px 11px;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237a7570' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;min-width:270px;cursor:pointer}
.sel-meta{font-size:11.5px;color:var(--sand);margin-left:4px}
/* STAT GRID */
.stat-grid{padding:18px 40px;max-width:1260px;width:100%;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.scard{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);padding:18px 20px 16px;position:relative;overflow:hidden}
.scard::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:var(--r-md) var(--r-md) 0 0}
.scard.t-teal::before{background:var(--teal)}
.scard.t-crimson::before{background:var(--crimson)}
.scard.t-amber::before{background:var(--amber)}
.scard.t-slate::before{background:var(--slate)}
.slabel{font-size:10px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.sval{font-family:'Playfair Display',Georgia,serif;font-size:30px;font-weight:700;line-height:1;color:var(--ink)}
.sval.teal{color:var(--teal)}.sval.crimson{color:var(--crimson)}.sval.amber{color:var(--amber)}
.ssub{font-size:11.5px;color:var(--muted);margin-top:5px}
.sdelta{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600;margin-top:6px;padding:3px 8px;border-radius:100px}
.sdelta.up{background:var(--teal-lt);color:var(--teal)}
.sdelta.dn{background:#fee2e2;color:var(--red)}
/* PROJ RANGE */
.proj-range{position:relative;height:6px;background:var(--hairline-soft);border-radius:100px;margin:10px 0 4px;overflow:visible}
.proj-fill{position:absolute;top:0;height:100%;background:linear-gradient(90deg,var(--teal-lt),#6ee7b7);border-radius:100px}
.proj-marker{position:absolute;top:-4px;width:14px;height:14px;background:var(--teal);border:2.5px solid #fff;border-radius:50%;transform:translateX(-50%);box-shadow:0 1px 4px rgba(0,0,0,.12)}
.proj-labels{display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}
/* CONTENT GRID */
.cg{padding:0 40px 40px;max-width:1260px;width:100%;margin:0 auto;display:grid;grid-template-columns:2fr 1fr;gap:18px;margin-top:0}
/* CARD */
.card{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);overflow:hidden}
.card-hdr{padding:16px 20px 0;display:flex;align-items:flex-start;justify-content:space-between}
.ctitle{font-size:10px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.csub{font-family:'Playfair Display',serif;font-size:16px;font-weight:600;color:var(--ink);margin-top:2px}
.cbody{padding:14px 20px 20px}
/* CHART SVG MOCK */
.chart-wrap{background:linear-gradient(180deg,var(--surface) 0%,var(--canvas) 100%);border-radius:var(--r-sm);padding:12px 8px 8px;margin-top:12px;position:relative;height:200px}
/* PEER FILTER */
.filter-row{display:flex;flex-wrap:wrap;gap:6px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--hairline-soft)}
.chip{font-size:11px;font-weight:500;padding:4px 11px;border-radius:100px;border:1px solid var(--hairline);background:var(--card);color:var(--body);cursor:pointer}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.chip.revue{border-color:var(--amber);color:var(--amber)}
.chip.drama{border-color:var(--slate);color:var(--slate)}
.chip.musical{border-color:var(--teal);color:var(--teal)}
/* MILESTONE TABLE */
.ms-table{width:100%;border-collapse:collapse;font-size:12px}
.ms-table thead th{font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:8px 9px;border-bottom:1px solid var(--hairline);text-align:left;white-space:nowrap}
.ms-table tbody td{padding:8px 9px;border-bottom:1px solid var(--hairline-soft);color:var(--body);font-variant-numeric:tabular-nums}
.ms-table tbody tr.today-row td{background:#f0fdf4}
.ms-table tbody tr:last-child td{border-bottom:none}
.mnum{font-weight:600;color:var(--ink)}
.mpos{color:var(--teal);font-weight:600}
.mneg{color:var(--red);font-weight:600}
.mdim{color:var(--sand)}
/* SIDEBAR */
.sidebar{display:flex;flex-direction:column;gap:16px}
/* TICKET MIX */
.mix-bar{display:flex;height:9px;border-radius:100px;overflow:hidden;margin:11px 0 9px}
.mix-seg{height:100%}
.mix-legend{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;margin-top:4px}
.mix-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--body)}
.mix-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.mix-pct{font-weight:600;color:var(--ink);margin-left:auto;font-variant-numeric:tabular-nums}
/* FILL BAR INLINE */
.fbar-wrap{display:inline-flex;align-items:center;gap:6px;min-width:90px}
.fbar-track{width:60px;height:5px;background:var(--hairline-soft);border-radius:100px;overflow:hidden}
.fbar-fill{height:100%;border-radius:100px}
.fbar-val{font-size:12px;font-weight:600;min-width:34px}
.c-green{color:var(--green)}.c-teal{color:var(--teal)}.c-amber{color:var(--amber)}.c-red{color:var(--red)}.c-slate{color:var(--slate)}
.bg-green{background:var(--green)}.bg-teal{background:var(--teal)}.bg-amber{background:var(--amber)}.bg-red{background:var(--red)}.bg-slate{background:var(--slate)}
/* BY PERFORMANCE */
.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:22px 40px 0;max-width:1260px;width:100%;margin:0 auto}
.kpi{background:var(--card);border:1px solid var(--hairline);border-radius:var(--r-md);padding:16px 18px 14px}
.kpi-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.kpi-val{font-family:'Playfair Display',serif;font-size:26px;font-weight:700;color:var(--ink);line-height:1}
.kpi-val.teal{color:var(--teal)}.kpi-val.amber{color:var(--amber)}.kpi-val.crimson{color:var(--crimson)}
.kpi-sub{font-size:11px;color:var(--muted);margin-top:5px}
.perf-wrap{margin:18px 40px 40px;max-width:1260px;width:100%;border:1px solid var(--hairline);border-radius:var(--r-md);overflow:hidden;background:var(--card)}
.perf-table-hdr{padding:14px 18px 12px;border-bottom:1px solid var(--hairline);display:flex;align-items:center;justify-content:space-between}
.perf-table{width:100%;border-collapse:collapse;font-size:12.5px}
.perf-table thead th{font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:9px 12px;border-bottom:1px solid var(--hairline);text-align:left;white-space:nowrap}
.grp-label{font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:7px 12px;background:var(--surface);color:var(--muted);border-top:1px solid var(--hairline-soft);border-bottom:1px solid var(--hairline-soft);display:flex;justify-content:space-between}
.grp-label span{font-weight:400;color:var(--sand)}
.perf-table tbody td{padding:9px 12px;border-bottom:1px solid var(--hairline-soft);color:var(--body);font-variant-numeric:tabular-nums;vertical-align:middle}
.perf-table tbody tr:last-child td{border-bottom:none}
.perf-table tbody tr.up-row td{background:#fffdf9}
.perf-table tbody tr.past-row td{background:#fafaf8;color:var(--muted)}
.dcell{font-weight:500;color:var(--ink)}
.scell{font-weight:700;color:var(--ink)}
/* FOOTNOTE */
.footnote{font-size:11px;color:var(--sand);padding:12px 20px;border-top:1px solid var(--hairline-soft);background:var(--surface);line-height:1.6}
</style>
</head>
<body>

<!-- NAV -->
<nav class="nav">
  <div class="nav-logo"><span class="logo-dot"></span>SLO Rep &middot; Analytics</div>
  <div class="nav-links">
    <div class="nav-link active" id="nl-pacing" onclick="go('pacing')">Pacing</div>
    <div class="nav-link" id="nl-byperformance" onclick="go('byperformance')">By Performance</div>
    <div class="nav-link">Season Subscription</div>
  </div>
  <div class="nav-right"><div class="live-badge">Live</div></div>
</nav>

<!-- SWITCHER -->
<div class="switcher">
  <span>Mockup &mdash; toggle pages:</span>
  <button class="sw-btn on" id="sw-pacing" onclick="go('pacing')">Pacing</button>
  <button class="sw-btn" id="sw-byperformance" onclick="go('byperformance')">By Performance</button>
</div>

<!-- ═══════════════════ PACING PAGE ═══════════════════ -->
<div class="pg active" id="pg-pacing">

  <div class="hdr">
    <div class="supertitle">SLO Rep &middot; Marketing Analytics</div>
    <div class="page-title">Ticket Pacing</div>
    <div class="page-meta">Cumulative sales vs. peer shows at the same stage &nbsp;&middot;&nbsp;
      <span style="color:#22c55e;font-weight:600">&#9679; Live via Spektrix</span>
    </div>
  </div>
  <div class="divider"></div>

  <div class="sel-row">
    <span class="sel-label">Show</span>
    <select class="show-sel">
      <option selected>A Grand Night for Singing (in progress)</option>
      <option>Cabaret</option>
      <option>Into the Woods</option>
    </select>
    <span class="sel-meta">25&ndash;26 season &nbsp;&middot;&nbsp; Musical Revue &nbsp;&middot;&nbsp; Opens Jun 5</span>
  </div>

  <!-- STAT CARDS -->
  <div class="stat-grid">
    <div class="scard t-teal">
      <div class="slabel">Run Total Sold</div>
      <div class="sval">1,609</div>
      <div class="ssub">of 2,052 capacity</div>
    </div>
    <div class="scard t-crimson">
      <div class="slabel">Overall Fill</div>
      <div class="sval teal">78.4%</div>
      <div class="ssub">all 19 performances</div>
    </div>
    <div class="scard t-amber">
      <div class="slabel">Vs Peer Median</div>
      <div class="sval" style="font-size:26px;padding-top:3px">+12.3%</div>
      <div class="sdelta up">&#8593; Ahead of pace</div>
    </div>
    <div class="scard t-slate">
      <div class="slabel">Projected Final (calibrated)</div>
      <div class="sval" style="font-size:24px;padding-top:3px">~1,694</div>
      <div class="proj-range" style="margin-top:10px">
        <!-- range 78%–87% of 2052; current marker at 82.4% -->
        <div class="proj-fill" style="left:0%;width:78%"></div><!-- floor = sold already, shown as saturated -->
        <div class="proj-fill" style="left:78%;width:9%;background:linear-gradient(90deg,#6ee7b7,#a7f3d0)"></div>
        <div class="proj-marker" style="left:82.4%"></div>
      </div>
      <div class="proj-labels">
        <span>78% floor</span><span style="font-weight:600;color:var(--teal)">~82%</span><span>87% ceiling</span>
      </div>
    </div>
  </div>

  <!-- CHART + SIDEBAR -->
  <div class="cg">

    <!-- LEFT: Chart + Milestones -->
    <div style="display:flex;flex-direction:column;gap:16px">

      <!-- Peer filter chips -->
      <div class="card">
        <div class="filter-row">
          <span style="font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);align-self:center;margin-right:8px">Peer shows</span>
          <div class="chip on">All seasons</div>
          <div class="chip revue">Revue</div>
          <div class="chip drama">Drama</div>
          <div class="chip musical">Musical</div>
          <div class="chip" style="margin-left:auto">24&ndash;25</div>
          <div class="chip">23&ndash;24</div>
          <div class="chip">22&ndash;23</div>
        </div>

        <div class="card-hdr">
          <div>
            <div class="ctitle">Cumulative Sales vs Peer Cohort</div>
            <div class="csub">A Grand Night for Singing &nbsp;<span style="font-weight:400;color:var(--muted);font-size:14px">vs 6 peers</span></div>
          </div>
          <div style="font-size:11px;color:var(--muted);text-align:right;padding-top:2px">Days from opening<br><span style="color:var(--ink);font-weight:500">d = +20 today</span></div>
        </div>

        <div class="cbody">
          <!-- MOCK CHART SVG -->
          <div class="chart-wrap">
            <svg viewBox="0 0 600 180" preserveAspectRatio="none" style="display:block;width:100%;height:100%">
              <!-- Grid lines -->
              <line x1="0" y1="36" x2="600" y2="36" stroke="#e4ddd5" stroke-width=".8"/>
              <line x1="0" y1="72" x2="600" y2="72" stroke="#e4ddd5" stroke-width=".8"/>
              <line x1="0" y1="108" x2="600" y2="108" stroke="#e4ddd5" stroke-width=".8"/>
              <line x1="0" y1="144" x2="600" y2="144" stroke="#e4ddd5" stroke-width=".8"/>
              <!-- Today line -->
              <line x1="430" y1="0" x2="430" y2="180" stroke="#bbb1a0" stroke-width="1" stroke-dasharray="4 3"/>
              <text x="434" y="12" font-size="9" fill="#7a7570" font-family="Inter,sans-serif">Today</text>
              <!-- Peer band -->
              <path d="M60,155 C120,145 180,120 240,98 C300,76 360,62 430,48 C470,40 510,36 560,34"
                stroke="none" fill="#e4ddd5" opacity=".5"
                d="M60,155 C120,145 180,130 240,112 C300,92 360,76 430,62 L430,38 C360,50 300,64 240,82 C180,102 120,118 60,128 Z"/>
              <!-- Peer median line -->
              <path d="M60,141 C120,131 180,116 240,97 C300,78 360,63 430,50 C470,44 510,40 560,38"
                stroke="#bbb1a0" stroke-width="1.5" fill="none" stroke-dasharray="5 3"/>
              <!-- Current show line (outperforming) -->
              <path d="M60,148 C120,133 180,108 240,82 C300,56 360,40 430,26 C470,20 510,17 560,16"
                stroke="#0f766e" stroke-width="2.5" fill="none"/>
              <!-- Current show dot at today -->
              <circle cx="430" cy="26" r="5" fill="#0f766e" stroke="white" stroke-width="2"/>
              <!-- Labels -->
              <text x="6" y="179" font-size="9" fill="#7a7570" font-family="Inter,sans-serif">d=−120</text>
              <text x="199" y="179" font-size="9" fill="#7a7570" font-family="Inter,sans-serif">d=0 Opening</text>
              <text x="548" y="179" font-size="9" fill="#7a7570" font-family="Inter,sans-serif">d=+28</text>
              <!-- Legend -->
              <rect x="460" y="88" width="130" height="44" rx="4" fill="white" stroke="#e4ddd5"/>
              <line x1="466" y1="100" x2="482" y2="100" stroke="#0f766e" stroke-width="2.5"/>
              <circle cx="474" cy="100" r="3" fill="#0f766e"/>
              <text x="486" y="103" font-size="9" fill="#3d3a36" font-family="Inter,sans-serif">A Grand Night</text>
              <line x1="466" y1="118" x2="482" y2="118" stroke="#bbb1a0" stroke-width="1.5" stroke-dasharray="4 2"/>
              <text x="486" y="121" font-size="9" fill="#3d3a36" font-family="Inter,sans-serif">Peer median</text>
            </svg>
          </div>
        </div>
      </div>

      <!-- Milestone table -->
      <div class="card">
        <div class="card-hdr">
          <div>
            <div class="ctitle">Milestone Comparison</div>
            <div class="csub">A Grand Night &nbsp;<span style="font-weight:400;color:var(--muted);font-size:14px">vs 6 peers</span></div>
          </div>
        </div>
        <div class="cbody" style="padding-top:8px">
          <table class="ms-table">
            <thead>
              <tr>
                <th>Days from open</th>
                <th>This show</th>
                <th>% capacity</th>
                <th>Peer median</th>
                <th>Peer % of final</th>
                <th>&Delta; vs peers</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="mdim">d = &minus;90</td><td class="mnum">312</td><td>15.2%</td><td class="mdim">271</td><td class="mdim">19.4%</td><td class="mpos">+15.1%</td></tr>
              <tr><td class="mdim">d = &minus;60</td><td class="mnum">588</td><td>28.7%</td><td class="mdim">491</td><td class="mdim">35.2%</td><td class="mpos">+19.8%</td></tr>
              <tr><td class="mdim">d = &minus;30</td><td class="mnum">921</td><td>44.9%</td><td class="mdim">782</td><td class="mdim">56.1%</td><td class="mpos">+17.8%</td></tr>
              <tr><td class="mdim">d = &minus;15</td><td class="mnum">1,142</td><td>55.6%</td><td class="mdim">977</td><td class="mdim">70.0%</td><td class="mpos">+16.9%</td></tr>
              <tr><td class="mdim">d = &minus;7</td><td class="mnum">1,334</td><td>65.0%</td><td class="mdim">1,091</td><td class="mdim">78.2%</td><td class="mpos">+22.3%</td></tr>
              <tr><td class="mdim">d = 0</td><td class="mnum">1,481</td><td>72.2%</td><td class="mdim">1,198</td><td class="mdim">85.8%</td><td class="mpos">+23.6%</td></tr>
              <tr class="today-row"><td style="font-weight:600;color:var(--ink)">d = +20 <span style="font-size:9px;color:var(--teal);background:var(--teal-lt);padding:1px 5px;border-radius:4px;margin-left:4px">TODAY</span></td><td class="mnum">1,609</td><td style="font-weight:600;color:var(--teal)">78.4%</td><td class="mdim">1,433</td><td class="mdim">92.1%</td><td class="mpos">+12.3%</td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div><!-- /LEFT -->

    <!-- RIGHT SIDEBAR -->
    <div class="sidebar">

      <!-- Ticket mix -->
      <div class="card">
        <div class="card-hdr">
          <div>
            <div class="ctitle">Ticket Mix</div>
            <div class="csub">A Grand Night for Singing</div>
          </div>
        </div>
        <div class="cbody">
          <div class="mix-bar">
            <div class="mix-seg" style="width:47%;background:#0f766e"></div>
            <div class="mix-seg" style="width:31%;background:#d97706"></div>
            <div class="mix-seg" style="width:9%;background:#475569"></div>
            <div class="mix-seg" style="width:13%;background:#bbb1a0"></div>
          </div>
          <div class="mix-legend">
            <div class="mix-item"><div class="mix-dot" style="background:#0f766e"></div>Single<span class="mix-pct">47%</span></div>
            <div class="mix-item"><div class="mix-dot" style="background:#d97706"></div>Subscriber<span class="mix-pct">31%</span></div>
            <div class="mix-item"><div class="mix-dot" style="background:#475569"></div>Group<span class="mix-pct">9%</span></div>
            <div class="mix-item"><div class="mix-dot" style="background:#bbb1a0"></div>Comp<span class="mix-pct">13%</span></div>
          </div>
          <div style="margin-top:12px;font-size:11px;color:var(--muted);border-top:1px solid var(--hairline-soft);padding-top:10px">
            Total counted: <strong style="color:var(--ink)">1,609</strong> tickets across 4 buckets
          </div>
        </div>
      </div>

      <!-- Projection detail -->
      <div class="card">
        <div class="card-hdr"><div><div class="ctitle">Projection Detail</div><div class="csub">Calibrated forecast</div></div></div>
        <div class="cbody">
          <div style="background:var(--surface);border-radius:6px;padding:12px 14px;text-align:center;margin-bottom:12px">
            <div style="font-family:'Playfair Display',serif;font-size:28px;font-weight:700;color:var(--teal)">~1,694</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">of 2,052 capacity</div>
          </div>
          <div class="proj-range">
            <div class="proj-fill" style="left:78%;width:9%;background:linear-gradient(90deg,#6ee7b7,#a7f3d0)"></div>
            <div class="proj-marker" style="left:82.4%"></div>
          </div>
          <div class="proj-labels"><span>78% floor</span><span style="font-weight:600;color:var(--teal)">82%</span><span>87%</span></div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--body)">
            <div style="display:flex;justify-content:space-between"><span>Category bias</span><span style="font-weight:600;color:var(--ink)">+7.9%</span></div>
            <div style="display:flex;justify-content:space-between"><span>MAPE (error band)</span><span style="font-weight:600;color:var(--ink)">&plusmn;8.6%</span></div>
            <div style="display:flex;justify-content:space-between"><span>Peers used</span><span style="font-weight:600;color:var(--ink)">6</span></div>
            <div style="display:flex;justify-content:space-between"><span>Current d</span><span style="font-weight:600;color:var(--teal)">+20</span></div>
          </div>
        </div>
      </div>

      <!-- Season context -->
      <div class="card">
        <div class="card-hdr"><div><div class="ctitle">Season Context</div><div class="csub">25&ndash;26 at a glance</div></div></div>
        <div class="cbody">
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--hairline-soft)">
              <span style="color:var(--body)">A Grand Night (current)</span>
              <span style="display:flex;align-items:center;gap:6px"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:78%"></div></div><span class="fbar-val c-teal">78%</span></span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--hairline-soft)">
              <span style="color:var(--muted)">Cabaret</span>
              <span style="display:flex;align-items:center;gap:6px"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:91%"></div></div><span class="fbar-val c-green">91%</span></span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--hairline-soft)">
              <span style="color:var(--muted)">Into the Woods</span>
              <span style="display:flex;align-items:center;gap:6px"><div class="fbar-track"><div class="fbar-fill bg-amber" style="width:64%"></div></div><span class="fbar-val c-amber">64%</span></span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
              <span style="color:var(--muted)">Ubu's Other Shoe</span>
              <span style="display:flex;align-items:center;gap:6px"><div class="fbar-track"><div class="fbar-fill bg-slate" style="width:55%"></div></div><span class="fbar-val c-slate">55%</span></span>
            </div>
          </div>
        </div>
      </div>

    </div><!-- /sidebar -->
  </div><!-- /cg -->
</div><!-- /pg-pacing -->


<!-- ═══════════════════ BY PERFORMANCE PAGE ═══════════════════ -->
<div class="pg" id="pg-byperformance">

  <div class="hdr">
    <div class="supertitle">SLO Rep &middot; Marketing Analytics</div>
    <div class="page-title">By Performance</div>
    <div class="page-meta">Tickets sold per instance vs capacity &nbsp;&middot;&nbsp;
      <span style="color:#22c55e;font-weight:600">&#9679; Live</span>
    </div>
  </div>
  <div class="divider"></div>

  <div class="sel-row">
    <span class="sel-label">Show</span>
    <select class="show-sel">
      <option selected>A Grand Night for Singing</option>
      <option>Cabaret</option>
      <option>Into the Woods</option>
    </select>
    <span class="sel-meta">19 performances &nbsp;&middot;&nbsp; 108 cap each &nbsp;&middot;&nbsp; 2,052 total</span>
  </div>

  <!-- KPI ROW -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-label">Run Total Sold</div>
      <div class="kpi-val">1,609</div>
      <div class="kpi-sub">of 2,052 capacity</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Overall Fill</div>
      <div class="kpi-val teal">78.4%</div>
      <div class="kpi-sub">all 19 performances</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Upcoming</div>
      <div class="kpi-val">5</div>
      <div class="kpi-sub">391 sold / 540 cap</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Upcoming Fill</div>
      <div class="kpi-val amber">72.4%</div>
      <div class="kpi-sub">avg across remaining shows</div>
    </div>
  </div>

  <!-- PERFORMANCE TABLE -->
  <div class="perf-wrap" style="margin-top:18px">
    <div class="perf-table-hdr">
      <div>
        <div class="ctitle">All Performances</div>
        <div class="csub" style="font-size:15px;margin-top:2px">A Grand Night for Singing</div>
      </div>
      <div style="font-size:11px;color:var(--muted)">Showing 19 of 19</div>
    </div>
    <table class="perf-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Time</th>
          <th>Sold</th>
          <th>Cap</th>
          <th>Fill</th>
        </tr>
      </thead>
      <tbody>
        <!-- UPCOMING GROUP -->
        <tr><td colspan="5" class="grp-label">Upcoming Performances <span>391 / 540 sold &middot; 72.4%</span></td></tr>
        <tr class="up-row"><td class="dcell">Thu Jun 26</td><td>7:00 PM</td><td class="scell">78</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:72%"></div></div><span class="fbar-val c-teal">72%</span></div></td></tr>
        <tr class="up-row"><td class="dcell">Sat Jun 27</td><td>2:00 PM</td><td class="scell">85</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:79%"></div></div><span class="fbar-val c-green">79%</span></div></td></tr>
        <tr class="up-row"><td class="dcell">Sat Jun 27</td><td>7:00 PM</td><td class="scell">59</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-amber" style="width:55%"></div></div><span class="fbar-val c-amber">55%</span></div></td></tr>
        <tr class="up-row"><td class="dcell">Sun Jun 28</td><td>2:00 PM</td><td class="scell">93</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:86%"></div></div><span class="fbar-val c-green">86%</span></div></td></tr>
        <tr class="up-row"><td class="dcell">Sun Jun 28</td><td>7:00 PM</td><td class="scell">76</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:70%"></div></div><span class="fbar-val c-teal">70%</span></div></td></tr>
        <!-- PAST GROUP -->
        <tr><td colspan="5" class="grp-label">Past Performances <span>1,218 / 1,512 sold &middot; 80.6%</span></td></tr>
        <tr class="past-row"><td class="dcell">Wed Jun 25</td><td>7:00 PM</td><td class="scell">85</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:79%"></div></div><span class="fbar-val c-teal">79%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sun Jun 22</td><td>2:00 PM</td><td class="scell">88</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:82%"></div></div><span class="fbar-val c-green">82%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sat Jun 21</td><td>7:00 PM</td><td class="scell">88</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:82%"></div></div><span class="fbar-val c-green">82%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sat Jun 21</td><td>2:00 PM</td><td class="scell">86</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:80%"></div></div><span class="fbar-val c-green">80%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Fri Jun 20</td><td>7:00 PM</td><td class="scell">86</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:80%"></div></div><span class="fbar-val c-green">80%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Thu Jun 19</td><td>7:00 PM</td><td class="scell">84</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:78%"></div></div><span class="fbar-val c-teal">78%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Wed Jun 18</td><td>7:00 PM</td><td class="scell">83</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:77%"></div></div><span class="fbar-val c-teal">77%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sun Jun 15</td><td>2:00 PM</td><td class="scell">97</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:90%"></div></div><span class="fbar-val c-green">90%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sat Jun 14</td><td>7:00 PM</td><td class="scell">78</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:72%"></div></div><span class="fbar-val c-teal">72%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sat Jun 14</td><td>2:00 PM</td><td class="scell">98</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:91%"></div></div><span class="fbar-val c-green">91%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sun Jun 8</td><td>2:00 PM</td><td class="scell">103</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:95%"></div></div><span class="fbar-val c-green">95%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sat Jun 7</td><td>7:00 PM</td><td class="scell">80</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-teal" style="width:74%"></div></div><span class="fbar-val c-teal">74%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Sat Jun 7</td><td>2:00 PM</td><td class="scell">74</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-amber" style="width:69%"></div></div><span class="fbar-val c-amber">69%</span></div></td></tr>
        <tr class="past-row"><td class="dcell">Fri Jun 6</td><td>7:00 PM</td><td class="scell">88</td><td>108</td><td><div class="fbar-wrap"><div class="fbar-track"><div class="fbar-fill bg-green" style="width:82%"></div></div><span class="fbar-val c-green">82%</span></div></td></tr>
      </tbody>
    </table>
    <!-- COLOR KEY -->
    <div style="display:flex;flex-wrap:wrap;gap:12px;padding:10px 14px 12px;border-top:1px solid var(--hairline-soft);background:var(--surface)">
      <span style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);align-self:center">Fill key:</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--green);border-radius:50%;display:inline-block"></span>90&ndash;100%</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--teal);border-radius:50%;display:inline-block"></span>75&ndash;89%</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--amber);border-radius:50%;display:inline-block"></span>60&ndash;74%</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--red);border-radius:50%;display:inline-block"></span>&lt;60%</span>
    </div>
    <div class="footnote">
      <strong>Capacity caveat:</strong> a few recent shows show &gt;100% sell-through against listed capacity, likely due to seat-hold release patterns not yet reconciled with Spektrix. Use % as directional, not exact.
    </div>
  </div>

</div><!-- /pg-byperformance -->

<script>
function go(page){
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'));
  document.getElementById('pg-'+page).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
  var nl=document.getElementById('nl-'+page);
  if(nl) nl.classList.add('active');
  document.querySelectorAll('.sw-btn').forEach(b=>b.classList.remove('on'));
  var sb=document.getElementById('sw-'+page);
  if(sb) sb.classList.add('on');
}
</script>
</body>
</html>
`;

export async function GET() {
  return new NextResponse(HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
