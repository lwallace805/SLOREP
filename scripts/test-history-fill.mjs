/**
 * Exercises the gap-fill logic against a mock Spektrix.
 *   node scripts/test-history-fill.mjs
 *
 * The live path cannot be reached from a sandbox, so everything that does not
 * require the network is pinned here instead: month batching, pagination,
 * date-window clipping, ticket→event matching, cumulative series building, and
 * every failure mode the route reports.
 */
import {
  monthRanges, scanOrders, buildSeries, scanWindow,
  countTicketsForEvent, orderDateOf, addDays, daysBetween,
} from '../src/lib/historyFill.js';

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`); }
};
const section = t => console.log(`\n${t}`);

const EVENT = 'EVT1';
const BASE = 'https://x/api/v3';
/** Build a mock fetchPage over a fixed set of orders. */
function mockApi(orders, opts = {}) {
  const calls = [];
  return {
    calls,
    fetchPage: async (url) => {
      calls.push(url);
      if (opts.failAll) return { error: opts.failAll };
      const u = new URL(url);
      const from = u.searchParams.get('DateFrom'), to = u.searchParams.get('DateTo');
      const page = Number(u.searchParams.get('page'));
      if (opts.failMonth && from.startsWith(opts.failMonth)) return { error: 'http 500' };
      const inWindow = orders.filter(o => {
        const d = orderDateOf(o);
        return d >= from && d <= to;
      });
      const size = opts.pageSize ?? 200;
      const slice = inWindow.slice((page - 1) * size, page * size);
      // Emulate a full page so the caller keeps paginating.
      if (opts.forceFullPages && slice.length) {
        while (slice.length < 200) slice.push({ createdAt: from + 'T10:00:00Z', tickets: [] });
      }
      return { orders: slice };
    },
  };
}
const order = (date, n, evt = EVENT) => ({
  createdAt: `${date}T12:00:00Z`,
  tickets: Array.from({ length: n }, () => ({ event: { id: evt } })),
});

section('monthRanges');
eq(monthRanges('2026-06-02', '2026-08-28').map(r => `${r.from}..${r.to}`),
   ['2026-06-02..2026-06-30', '2026-07-01..2026-07-31', '2026-08-01..2026-08-28'], 'spans three months, clipped');
eq(monthRanges('2026-08-28', '2026-08-28').map(r => `${r.from}..${r.to}`),
   ['2026-08-28..2026-08-28'], 'single day');
eq(monthRanges('2025-12-20', '2026-01-05').map(r => `${r.from}..${r.to}`),
   ['2025-12-20..2025-12-31', '2026-01-01..2026-01-05'], 'crosses year boundary');
eq(monthRanges('2026-08-28', '2026-06-02'), [], 'inverted range yields nothing');

section('ticket → event matching');
eq(countTicketsForEvent({ tickets: [{ event: { id: 'EVT1' } }, { event: { id: 'OTHER' } }] }, 'EVT1'), 1, 'nested object id');
eq(countTicketsForEvent({ tickets: [{ event: 'EVT1' }, { event: 'EVT1' }] }, 'EVT1'), 2, 'bare string id');
eq(countTicketsForEvent({ tickets: [{}, { event: null }] }, 'EVT1'), 0, 'missing event does not match');
eq(countTicketsForEvent({}, 'EVT1'), 0, 'order with no tickets');
eq(orderDateOf({ purchasedAt: '2026-07-04T09:00:00Z' }), '2026-07-04', 'falls back to purchasedAt');
eq(orderDateOf({}), '', 'no date field');

section('scanWindow');
eq(scanWindow('2026-06-02', '2026-08-28'), { scanFrom: '2026-06-02', scanTo: '2026-08-28', truncated: false }, '88-day gap fits inside the 120-day cap');
eq(scanWindow('2026-01-01', '2026-08-28').truncated, true, 'gap beyond the cap is flagged truncated');
eq(scanWindow('2026-09-30', '2026-08-28'), { scanFrom: '2026-08-28', scanTo: '2026-08-28', truncated: false }, 'future fromDate clamps to today');

section('scanOrders — happy path');
{
  const orders = [order('2026-06-10', 5), order('2026-07-04', 12), order('2026-08-28', 3), order('2026-07-04', 2, 'OTHER')];
  const api = mockApi(orders);
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-02', scanTo: '2026-08-28', base: BASE, fetchPage: api.fetchPage });
  eq(r.complete, true, 'complete');
  eq(r.byDay, { '2026-06-10': 5, '2026-07-04': 12, '2026-08-28': 3 }, 'counts per day, other events excluded');
  eq(r.matchedTickets, 20, 'matched ticket total');
  eq(r.ticketsSeen, 22, 'ticketsSeen counts every ticket, matched or not');
  eq(r.ordersSeen, 4, 'ordersSeen counts every order');
  eq(api.calls.length, 3, 'one call per month, no needless pagination');
  eq(r.lastError, null, 'no error');
}

section('scanOrders — failure modes');
{
  const api = mockApi([], { failAll: 'timeout after 25000ms' });
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-02', scanTo: '2026-08-28', base: BASE, fetchPage: api.fetchPage });
  eq(r.complete, false, 'total failure marked incomplete');
  eq(r.ordersSeen, 0, 'ordersSeen 0 — this is what the deployed endpoint reported');
  eq(r.matchedTickets, 0, 'nothing matched');
  eq(/timeout after 25000ms/.test(r.lastError || ''), true, 'lastError names the timeout');
}
{
  const api = mockApi([order('2026-06-10', 5), order('2026-08-02', 9)], { failMonth: '2026-07' });
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-02', scanTo: '2026-08-28', base: BASE, fetchPage: api.fetchPage });
  eq(r.complete, false, 'one bad month marks the whole scan incomplete');
  eq(r.byDay, { '2026-06-10': 5, '2026-08-02': 9 }, 'the months that worked still contribute');
  eq(/2026-07/.test(r.lastError || ''), true, 'lastError names the failing month');
}
{
  // Every page full ⇒ pagination runs to the ceiling and must flag itself.
  const many = Array.from({ length: 400 }, (_, i) => order('2026-06-10', 1));
  const api = mockApi(many, { forceFullPages: true, pageSize: 200 });
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-01', scanTo: '2026-06-30', base: BASE, fetchPage: api.fetchPage, maxPages: 2 });
  eq(r.complete, false, 'hitting the page ceiling marks the scan incomplete');
  eq(/ceiling/.test(r.lastError || ''), true, 'lastError names the ceiling');
}

section('buildSeries');
{
  const r = buildSeries({
    byDay: { '2026-06-10': 5, '2026-07-04': 12 }, baselineCount: 31,
    openDate: '2026-08-28', scanFrom: '2026-06-02', scanTo: '2026-08-28',
    today: '2026-08-28', truncated: false,
  });
  eq(r.series, [{ d: -87, c: 31 }, { d: -79, c: 36 }, { d: -55, c: 48 }, { d: 0, c: 48 }], 'cumulative, with a closing point at today');
  eq(r.total, 48, 'total');
}
{
  const r = buildSeries({
    byDay: {}, baselineCount: 31, openDate: '2026-08-28',
    scanFrom: '2026-06-02', scanTo: '2026-07-31', today: '2026-08-28', truncated: true,
  });
  eq(r.series.some(p => p.d === 0), false, 'a truncated scan emits no point at today — it must not collide with the live reading');
}
{
  // The exact deployed shape: scan completes, matches nothing.
  const r = buildSeries({
    byDay: {}, baselineCount: 31, openDate: '2026-08-28',
    scanFrom: '2026-06-02', scanTo: '2026-08-28', today: '2026-08-28', truncated: false,
  });
  eq(r.series, [{ d: -87, c: 31 }, { d: 0, c: 31 }], 'zero-match scan produces the flat run the client must distrust');
  eq(r.total - 31, 0, 'found = 0');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
