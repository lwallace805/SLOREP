/**
 * Where each production sits in its lifecycle, derived from dates.
 *
 * The season data in src/data/pacingData.js carries an `inProgress` boolean that
 * has to be hand-edited every time a show opens or closes. It is always stale:
 * on 2026-08-25 it still flagged Finding Nemo (closed in July) as in progress
 * and treated The Father (opening in three days) as a finished show with a
 * final of 31 tickets. Everything downstream — the default selection, whether
 * live Spektrix data is fetched, whether `final` means "final" — read that flag,
 * so the whole dashboard pointed at the wrong show.
 *
 * Nothing here reads `inProgress`. Status comes from the run window: opening
 * date from the season data, closing date from Spektrix when we have it.
 */

import { getEvents } from './spektrix';

// Fallback run lengths, used only when Spektrix has no window for a show —
// older seasons, where the exact closing date is moot because the run ended
// years ago, and any moment the API is unreachable. Drawn from the last data
// point of each completed show's series: mainstage runs end around d+16 to
// d+30, while the Ubu's Other Shoe staged readings all end at d+1.
export const ASSUMED_RUN_DAYS = 28;
export const ASSUMED_RUN_DAYS_BY_CAT = { ubu: 2 };

// Ubu's Other Shoe is the studio staged-reading series — a weekend each, on a
// separate track from the mainstage season. It should not be what the dashboard
// opens on just because a reading happens to fall this week.
const SIDE_STRAND_CATS = new Set(['ubu']);

/** Today in Pacific time as YYYY-MM-DD. The theatre is in San Luis Obispo. */
export function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function utcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(dateStr, n) {
  return new Date(utcMs(dateStr) + n * 86400000).toISOString().slice(0, 10);
}

/** Days from a show's opening night. Negative before opening, 0 on the night. */
export function daysFromOpen(openDate, today = pacificToday()) {
  return Math.round((utcMs(today) - utcMs(openDate)) / 86400000);
}

/**
 * Closing dates keyed by lowercased show name, read from Spektrix.
 * Server-side only — it calls the Spektrix API.
 *
 * Returns { [name]: { open, close } }.
 */
export async function getRunWindows() {
  const events = await getEvents();
  const windows = {};
  for (const e of events) {
    if (!e.name || !e.firstInstanceDateTime) continue;
    windows[e.name.toLowerCase()] = {
      open: e.firstInstanceDateTime.slice(0, 10),
      close: (e.lastInstanceDateTime || e.firstInstanceDateTime).slice(0, 10),
    };
  }
  return windows;
}

/** Closing date for a show: Spektrix's if we have it, else the run-length guess. */
export function closeDateFor(show, runWindows = {}) {
  const known = runWindows[show.name?.toLowerCase()]?.close;
  if (known) return known;
  const days = ASSUMED_RUN_DAYS_BY_CAT[show.cat] ?? ASSUMED_RUN_DAYS;
  return addDays(show.open, days);
}

/** 'upcoming' (on sale, not yet opened) | 'running' | 'past'. */
export function statusOf(show, runWindows = {}, today = pacificToday()) {
  if (today > closeDateFor(show, runWindows)) return 'past';
  if (today < show.open) return 'upcoming';
  return 'running';
}

/**
 * True while the run has not finished — the window in which Spektrix numbers
 * still move, so live data is worth fetching and `final` is not yet final.
 * Both upcoming and running shows qualify: a show three days from opening is
 * in the most important stretch of its sales curve.
 */
export function isOnSale(show, runWindows = {}, today = pacificToday()) {
  return statusOf(show, runWindows, today) !== 'past';
}

/**
 * The production the marketing team is working right now: of the shows whose
 * run has not ended, the one opening soonest. A show already running wins over
 * one still to open, because its opening date is earlier.
 *
 * Falls back to the most recently opened show once the season is over.
 */
export function currentShowName(shows, runWindows = {}, today = pacificToday()) {
  if (!shows?.length) return null;
  const onSale = shows.filter(s => isOnSale(s, runWindows, today));
  // Mainstage first; only fall through to the studio series if nothing on the
  // mainstage is on sale.
  const mainstage = onSale.filter(s => !SIDE_STRAND_CATS.has(s.cat));
  const pool = mainstage.length ? mainstage : onSale;
  if (pool.length) return pool.reduce((a, b) => (a.open <= b.open ? a : b)).name;
  // The season is over — fall back to the most recently opened show.
  return shows.reduce((a, b) => (a.open >= b.open ? a : b))?.name ?? null;
}

/**
 * Same choice, for the shape /api/shows returns ({name, firstInstance,
 * lastInstance}) rather than the season data.
 */
export function currentShowFromEvents(events, today = pacificToday()) {
  const dated = (events || []).filter(e => e.name && e.firstInstance);
  if (!dated.length) return null;
  const onSale = dated.filter(
    e => (e.lastInstance || e.firstInstance).slice(0, 10) >= today
  );
  // Spektrix has no category field, so identify the studio series by name.
  const mainstage = onSale.filter(e => !/^staged reading/i.test(e.name));
  const pool = mainstage.length ? mainstage : onSale;
  if (pool.length) {
    return pool.reduce((a, b) => (a.firstInstance <= b.firstInstance ? a : b)).name;
  }
  return dated.reduce((a, b) => (a.firstInstance >= b.firstInstance ? a : b)).name;
}
