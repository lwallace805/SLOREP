import assert from 'node:assert/strict';
import { buildAxis, posOfDay, dayAtPos, perfDaysFor } from '../src/lib/campaignAxis.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Gutenberg! The Musical!, 2026-10-09: fourteen performances over five weekends.
const gutenberg = {
  open: '2026-10-09',
  perfs: ['2026-10-09 19:00', '2026-10-10 14:00', '2026-10-10 19:00', '2026-10-11 14:00',
          '2026-10-16 19:00', '2026-10-17 14:00', '2026-10-17 19:00', '2026-10-18 14:00',
          '2026-10-23 19:00', '2026-10-24 19:00', '2026-10-25 14:00', '2026-10-30 19:00',
          '2026-11-01 14:00', '2026-11-07 14:00'],
};
// Finding Nemo, 2026-07-10: eleven performances over two weekends.
const nemo = {
  open: '2026-07-10',
  perfs: ['2026-07-10 19:00', '2026-07-11 14:00', '2026-07-11 19:00', '2026-07-12 14:00',
          '2026-07-12 19:00', '2026-07-15 19:00', '2026-07-17 19:00', '2026-07-18 14:00',
          '2026-07-18 19:00', '2026-07-19 14:00', '2026-07-19 19:00'],
};

ok('performance days are offsets from opening, sorted', () => {
  assert.deepEqual(perfDaysFor(gutenberg.open, gutenberg.perfs), [0, 1, 1, 2, 7, 8, 8, 9, 14, 15, 16, 21, 23, 29]);
});

ok('performances before the opening date are ignored', () => {
  assert.deepEqual(perfDaysFor('2026-10-09', ['2026-10-08 19:00', '2026-10-09 19:00']), [0]);
});

ok('pre-opening positions are the day itself on every basis', () => {
  const a = buildAxis(gutenberg), b = buildAxis({ open: '2026-10-09', runDays: 28 });
  for (const d of [-180, -30, -1, 0]) { assert.equal(posOfDay(a, d), d); assert.equal(posOfDay(b, d), d); assert.equal(dayAtPos(a, d), d); assert.equal(dayAtPos(b, d), d); }
});

ok('on a performance day the position is the share played before that day', () => {
  const a = buildAxis(gutenberg);
  near(posOfDay(a, 1), 1 / 14 * 100);     // opening night has played
  near(posOfDay(a, 2), 3 / 14 * 100);     // plus two on Saturday
  near(posOfDay(a, 7), 4 / 14 * 100);     // Sunday matinee played; next Friday
  near(posOfDay(a, 29), 13 / 14 * 100);   // closing day: all but the closing show
});

ok('between performance days the position moves linearly toward the next', () => {
  const a = buildAxis(gutenberg);
  near(posOfDay(a, 4), (3 + 2 / 5) / 14 * 100);   // Tuesday, two of five days from Sun to Fri
});

ok('the day after closing is 100% and later days stay there', () => {
  const a = buildAxis(gutenberg);
  assert.equal(posOfDay(a, 30), 100);
  assert.equal(posOfDay(a, 60), 100);
  assert.equal(dayAtPos(a, 100), 30);
  assert.equal(a.runDays, 29);
  assert.equal(a.n, 14);
  assert.equal(a.basis, 'performances');
});

ok('dayAtPos inverts posOfDay on each performance day', () => {
  const a = buildAxis(gutenberg);
  for (const d of [1, 2, 7, 8, 9, 14, 15, 16, 21, 23, 29]) assert.equal(dayAtPos(a, posOfDay(a, d)), d);
});

ok('a peer is read at the same share of its own performances', () => {
  const g = buildAxis(gutenberg), n = buildAxis(nemo);
  const x = posOfDay(g, 4);                       // Gutenberg's Tuesday after opening weekend
  near(x, 24.2857, 1e-3);
  // Nemo: 2.67 of 11 played lands between Saturday (1 played) and Sunday (3 played).
  assert.equal(dayAtPos(n, x), 2);
  near(posOfDay(n, 5), 5 / 11 * 100);            // Wednesday show: the weekend's five have played
});

ok('without a performance list the axis is the calendar share of the run', () => {
  const a = buildAxis({ open: '2023-09-15', runDays: 30 });
  assert.equal(a.basis, 'calendar');
  near(posOfDay(a, 15), 50);
  assert.equal(dayAtPos(a, 50), 15);
  assert.equal(dayAtPos(a, 100), 30);
  assert.equal(posOfDay(a, 45), 100);
});

ok('an unknown run length still yields a usable axis', () => {
  const a = buildAxis({ open: '2023-09-15' });
  assert.equal(a.runDays, 1);
  assert.equal(posOfDay(a, 1), 100);
});

console.log(`\n${passed} passed, 0 failed`);
