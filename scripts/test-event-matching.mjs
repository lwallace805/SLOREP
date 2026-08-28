/**
 * Spektrix event lookup by show name.
 *   node scripts/test-event-matching.mjs
 *
 * Season-file names and Spektrix billing titles disagree — "Finding Nemo"
 * against "Finding Nemo JR." — and an exact-only match drops those shows
 * silently, leaving a frozen export figure on screen with nothing to indicate
 * a failure. Equally, a loose match must never bind to the wrong production.
 */
import { findEvent } from '../src/lib/spektrix.js';

let pass = 0, fail = 0;
const check = (cond, label) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};

const CATALOGUE = [
  { name: 'Finding Nemo JR.', id: 'a' },
  { name: 'The Father', id: 'b' },
  { name: 'Gutenberg! The Musical!', id: 'c' },
  { name: 'Three Tall Women', id: 'd' },
  { name: 'Staged Reading: The Designated Mourner', id: 'e' },
  { name: '25th Annual Putnam County Spelling Bee', id: 'f' },
];

console.log('resolves season names to Spektrix titles');
for (const [query, expected] of [
  ['Finding Nemo', 'Finding Nemo JR.'],
  ['The Father', 'The Father'],
  ['Gutenberg! The Musical!', 'Gutenberg! The Musical!'],
  ['Three Tall Women', 'Three Tall Women'],
  ['Staged Reading: The Designated Mourner', 'Staged Reading: The Designated Mourner'],
  ['25th Annual Putnam County Spelling Bee', '25th Annual Putnam County Spelling Bee'],
]) {
  const got = findEvent(CATALOGUE, query)?.name ?? null;
  check(got === expected, `${query} -> ${got}`);
}

console.log('\nrefuses rather than guessing');
check(findEvent(CATALOGUE, 'Nonexistent Show') === null, 'unknown title returns null');
check(findEvent([], 'The Father') === null, 'empty catalogue returns null');
check(findEvent(CATALOGUE, '') === null, 'empty query returns null');
check(findEvent(CATALOGUE, null) === null, 'null query returns null');
check(findEvent([{ name: 'Nemo A' }, { name: 'Nemo B' }], 'Nemo') === null,
  'two candidates differing only by a trailing token do not bind');
check(findEvent([{ name: 'Finding Nemo JR.' }, { name: 'Finding Nemo The Musical' }], 'Finding Nemo') === null,
  'two titles that normalise identically do not bind');
check(findEvent([{ name: 'The Father' }, { name: 'Father' }], 'The Father')?.name === 'The Father',
  'exact match wins over a normalised rival');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
