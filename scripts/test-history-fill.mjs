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
  dateWindows, scanOrders, buildSeries, scanWindow,
  countTicketsForEvent, orderDateOf, addDays, daysBetween, isPaidTicket, COMP_TYPE_IDS,
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
      if (opts.failWindowFrom && from === opts.failWindowFrom) return { error: 'http 500' };
      const inWindow = orders.filter(o => {
        const d = orderDateOf(o);
        return d >= from && d <= to;
      });
      const size = opts.pageSize ?? 200;
      const slice = inWindow.slice((page - 1) * size, page * size);
      // Emulate a full page so the caller keeps paginating.
      if (opts.forceFullPages && slice.length) {
        while (slice.length < 200) slice.push({ firstTransactionDate: from + 'T10:00:00', tickets: [] });
      }
      return { orders: slice };
    },
  };
}
const order = (date, n, evt = EVENT) => ({
  firstTransactionDate: `${date}T12:00:00`,
  tickets: Array.from({ length: n }, () => ({ event: { id: evt }, originalPrice: 45 })),
});

section('dateWindows');
{
  const w = dateWindows('2026-06-02', '2026-08-28');
  eq(w.length, 22, '88 days becomes 22 windows');
  eq(w[0], { from: '2026-06-02', to: '2026-06-05' }, 'first window is four days');
  eq(w[w.length - 1].to, '2026-08-28', 'last window ends on the requested end');
  let contiguous = true;
  for (let i = 1; i < w.length; i++) if (addDays(w[i - 1].to, 1) !== w[i].from) contiguous = false;
  eq(contiguous, true, 'windows are contiguous with no gaps or overlaps');
}
eq(dateWindows('2026-08-28', '2026-08-28').map(r => `${r.from}..${r.to}`),
   ['2026-08-28..2026-08-28'], 'single day');
eq(dateWindows('2025-12-28', '2026-01-05').map(r => `${r.from}..${r.to}`),
   ['2025-12-28..2025-12-31', '2026-01-01..2026-01-04', '2026-01-05..2026-01-05'], 'crosses year boundary');
eq(dateWindows('2026-08-28', '2026-06-02'), [], 'inverted range yields nothing');

section('ticket → event matching');
eq(countTicketsForEvent({ tickets: [{ event: { id: 'EVT1' }, originalPrice: 45 }, { event: { id: 'OTHER' }, originalPrice: 45 }] }, 'EVT1'), 1, 'nested object id');
eq(countTicketsForEvent({ tickets: [{ event: 'EVT1', originalPrice: 45 }, { event: 'EVT1', originalPrice: 45 }] }, 'EVT1'), 2, 'bare string id');
eq(countTicketsForEvent({ tickets: [{}, { event: null }] }, 'EVT1'), 0, 'missing event does not match');
eq(countTicketsForEvent({}, 'EVT1'), 0, 'order with no tickets');
eq(orderDateOf({ firstTransactionDate: '2026-07-04T09:00:00' }), '2026-07-04', "reads Spektrix's firstTransactionDate");
eq(orderDateOf({ firstTransactionDateUtc: '2026-07-05T02:00:00Z' }), '2026-07-05', 'falls back to the Utc variant');
eq(orderDateOf({ firstTransactionDate: '2026-07-04T09:00:00', firstTransactionDateUtc: '2026-07-05T02:00:00Z' }),
   '2026-07-04', 'local date wins so days bucket against the theatre calendar');
eq(orderDateOf({ purchasedAt: '2026-07-04T09:00:00Z' }), '2026-07-04', 'still accepts purchasedAt');
eq(orderDateOf({}), '', 'no date field');
{
  // The exact regression: a real Spektrix order carrying the right event id.
  const real = { firstTransactionDate: '2026-08-26T14:03:00', tickets: [{ event: { id: 'EVT1' }, originalPrice: 45 }, { event: { id: 'OTHER' }, originalPrice: 45 }] };
  eq(orderDateOf(real) !== '', true, 'a real order shape yields a usable date');
  eq(countTicketsForEvent(real, 'EVT1'), 1, 'and its tickets match');
}

section('paid-ticket rule');
{
  const comp = [...COMP_TYPE_IDS][0];
  eq(isPaidTicket({ originalPrice: 42 }), true, 'a priced ticket is paid');
  eq(isPaidTicket({ originalPrice: 0 }), false, 'a zero original price is not paid');
  eq(isPaidTicket({ type: { id: comp }, originalPrice: 42 }), false, 'a comp type is not paid, whatever its price');
  eq(isPaidTicket({ ticketType: { id: comp }, originalPrice: 42 }), false, 'comp under ticketType is also caught');
  eq(isPaidTicket({}), true, 'an unpriced-but-untyped ticket still counts');
  const mixed = { firstTransactionDate: '2026-08-26T10:00:00', tickets: [
    { event: { id: EVENT }, originalPrice: 45 },
    { event: { id: EVENT }, originalPrice: 0 },
    { event: { id: EVENT }, type: { id: comp }, originalPrice: 45 },
    { event: { id: 'OTHER' }, originalPrice: 45 },
  ] };
  eq(countTicketsForEvent(mixed, EVENT), 1, 'only the paid ticket for this event counts');
}

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
  eq(api.calls.length, dateWindows('2026-06-02', '2026-08-28').length, 'one call per window, no needless pagination');
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
  // Fail one mid-July window that holds none of the test orders, so the good
  // windows must still contribute everything.
  const api = mockApi([order('2026-06-10', 5), order('2026-08-02', 9)], { failWindowFrom: '2026-07-08' });
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-02', scanTo: '2026-08-28', base: BASE, fetchPage: api.fetchPage });
  eq(r.complete, false, 'one bad window marks the whole scan incomplete');
  eq(r.byDay, { '2026-06-10': 5, '2026-08-02': 9 }, 'the windows that worked still contribute');
  eq(/2026-07-08/.test(r.lastError || ''), true, 'lastError names the failing window');
}
{
  // Every page full ⇒ pagination runs to the ceiling and must flag itself.
  const many = Array.from({ length: 400 }, (_, i) => order('2026-06-10', 1));
  const api = mockApi(many, { forceFullPages: true, pageSize: 200 });
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage, maxPages: 2 });
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

section('scanOrders — page waves and deadline');
{
  // Two full pages in one month: page 1 in wave one, the rest in wave two.
  const many = Array.from({ length: 400 }, () => order('2026-06-10', 1));
  const api = mockApi(many, { forceFullPages: true, pageSize: 200 });
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage, maxPages: 4 });
  const pages = api.calls.map(u => Number(new URL(u).searchParams.get('page'))).sort();
  eq(pages, [1, 2, 3, 4], 'a full first page triggers the remaining pages');
  eq(r.ordersSeen > 0, true, 'orders ingested across waves');
}
{
  // A month whose first page is not full must not fetch any further pages.
  const api = mockApi([order('2026-06-10', 3)]);
  await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage, maxPages: 4 });
  eq(api.calls.length, 1, 'a short first page ends the window');
}
{
  // An expired deadline abandons the scan rather than running past the budget.
  const api = mockApi([order('2026-06-10', 3)]);
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-02', scanTo: '2026-08-28', base: BASE, fetchPage: api.fetchPage, deadline: Date.now() - 1 });
  eq(api.calls.length, 0, 'no requests made once the deadline has passed');
  eq(r.complete, false, 'marked incomplete');
  eq(/deadline/.test(r.lastError || ''), true, 'lastError names the deadline');
}

section('duplicate orders across windows');
{
  // The same order returned in two windows — Spektrix matches an order whose
  // transactions touch the range, and a payment plan touches several.
  const dup = { id: 'ORD1', firstTransactionDate: '2026-06-10T10:00:00',
                tickets: [{ event: { id: EVENT }, originalPrice: 45 }, { event: { id: EVENT }, originalPrice: 45 }] };
  const api = { calls: [], fetchPage: async (u) => { api.calls.push(u); return { orders: [dup] }; } };
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-28', base: BASE, fetchPage: api.fetchPage });
  eq(api.calls.length >= 3, true, 'several windows each returned the order');
  eq(r.byDay, { '2026-06-10': 2 }, 'its tickets are counted once, not once per window');
  eq(r.matchedTickets, 2, 'matched total is not inflated');
  eq(r.uniqueOrders, 1, 'one unique order');
}

section('bucketing every event in one pass');
{
  const mixed = [
    { id: 'O1', firstTransactionDate: '2026-06-10T10:00:00', tickets: [
      { event: { id: 'EVT1' }, originalPrice: 45 },
      { event: { id: 'EVT2' }, originalPrice: 45 },
      { event: { id: 'EVT2' }, originalPrice: 0 },
    ] },
    { id: 'O2', firstTransactionDate: '2026-06-11T10:00:00', tickets: [
      { event: { id: 'EVT2' }, originalPrice: 45 },
    ] },
  ];
  const api = mockApi(mixed);
  const r = await scanOrders({ eventId: null, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage });
  eq(r.byEventDay, { EVT1: { '2026-06-10': 1 }, EVT2: { '2026-06-10': 1, '2026-06-11': 1 } },
     'every event is bucketed by day, comps excluded');
  eq(r.matchedTickets, 3, 'with no eventId, all paid tickets count');
  eq(r.byDay, {}, 'no single-show series when no eventId is given');
}
{
  // With an eventId the single-show series still works, and the all-event
  // buckets come along for free.
  const api = mockApi([order('2026-06-10', 2), order('2026-06-10', 5, 'OTHER')]);
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage });
  eq(r.byDay, { '2026-06-10': 2 }, 'target show series unchanged');
  eq(r.matchedTickets, 2, 'matched counts only the target show');
  eq(r.byEventDay.OTHER, { '2026-06-10': 5 }, 'other shows are bucketed too');
}

section('sales attributed to the performance bought');
{
  const orders = [
    { id: 'A', firstTransactionDate: '2026-06-10T10:00:00', tickets: [
      { event: { id: EVENT }, instance: { id: 'I-THU' }, originalPrice: 45 },
      { event: { id: EVENT }, instance: { id: 'I-THU' }, originalPrice: 45 },
      { event: { id: EVENT }, instance: { id: 'I-FRI' }, originalPrice: 45 },
      { event: { id: EVENT }, instance: { id: 'I-FRI' }, originalPrice: 0 },
      { event: { id: 'OTHER' }, instance: { id: 'X' }, originalPrice: 45 },
    ] },
    { id: 'B', firstTransactionDate: '2026-06-11T10:00:00', tickets: [
      { event: { id: EVENT }, instance: 'I-THU', originalPrice: 45 },
    ] },
  ];
  const api = mockApi(orders);
  const r = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage });
  eq(r.byInstanceDay, {
    'I-THU': { '2026-06-10': 2, '2026-06-11': 1 },
    'I-FRI': { '2026-06-10': 1 },
  }, 'each sale lands on the performance it was bought for, comps excluded, string ids accepted');
  eq(r.byDay, { '2026-06-10': 3, '2026-06-11': 1 }, 'the day totals still agree with the per-performance split');
}
{
  // Without an eventId the per-instance map stays empty rather than ballooning
  // across the whole season.
  const api = mockApi([order('2026-06-10', 2)]);
  const r = await scanOrders({ eventId: null, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: api.fetchPage });
  eq(r.byInstanceDay, {}, 'no per-performance split when no show is targeted');
}

section('comps');
{
  const orders = [{ id: 'C1', firstTransactionDate: '2026-06-10T10:00:00', tickets: [
    { event: { id: EVENT }, instance: { id: 'I1' }, originalPrice: 45 },
    { event: { id: EVENT }, instance: { id: 'I1' }, originalPrice: 0 },
    { event: { id: EVENT }, instance: { id: 'I1' }, type: { id: [...COMP_TYPE_IDS][0] }, originalPrice: 45 },
  ] }];
  const paidOnly = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: mockApi(orders).fetchPage });
  eq(paidOnly.byDay, { '2026-06-10': 1 }, 'by default only the paid ticket counts');
  eq(paidOnly.compTickets, 0, 'comps are not counted when excluded');

  const withComps = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: mockApi(orders).fetchPage, includeComps: true });
  eq(withComps.byDay, { '2026-06-10': 3 }, 'with comps included every seat counts');
  eq(withComps.byInstanceDay, { I1: { '2026-06-10': 3 } }, 'and lands on the right performance');
  eq(withComps.compTickets, 2, 'comps are reported separately so a view can say how many');

  // Comps belonging to other shows must not inflate this show's figure.
  const mixedShows = [{ id: 'C2', firstTransactionDate: '2026-06-10T10:00:00', tickets: [
    { event: { id: EVENT }, instance: { id: 'I1' }, originalPrice: 0 },
    { event: { id: 'OTHER' }, instance: { id: 'I9' }, originalPrice: 0 },
    { event: { id: 'OTHER' }, instance: { id: 'I9' }, originalPrice: 0 },
  ] }];
  const scoped = await scanOrders({ eventId: EVENT, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: mockApi(mixedShows).fetchPage, includeComps: true });
  eq(scoped.compTickets, 1, "only the targeted show's comps are counted");
  const unscoped = await scanOrders({ eventId: null, scanFrom: '2026-06-08', scanTo: '2026-06-11', base: BASE, fetchPage: mockApi(mixedShows).fetchPage, includeComps: true });
  eq(unscoped.compTickets, 3, 'with no show targeted every comp counts');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
