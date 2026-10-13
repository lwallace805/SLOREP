/**
 * The campaign axis: one scale every show can be read on.
 *
 * Before opening a position is the day from opening, shared by every show
 * because the marketing window runs on the calendar: subscriber allocation,
 * single tickets on sale, the final push all land at the same days out.
 *
 * After opening a position is the share of the run's performances that have
 * played, as a percent. Runs here range from a two-weekend play (eleven
 * performances) to a five-weekend musical (fourteen spread over a month), and
 * the question the dashboard asks after opening is "how full was the house for
 * peers when they had played this much of their run?". Calendar days answer a
 * different question: four days into the long run three performances have
 * played, while the short run has played five, and reading both at "day +4"
 * counts the long run's slower schedule as being behind. Performances played
 * is also what the seats already sold are measured against: a house that has
 * played cannot be sold.
 *
 * Within a run the position moves continuously. On the day of a performance
 * it is exactly the share played before that day; between performance days it
 * moves linearly toward the next one, so a sale on a quiet Tuesday still lands
 * somewhere rather than on top of Sunday's. The day after the closing
 * performance is 100%. A show whose performance list is unknown falls back to
 * the share of its run elapsed in calendar days, which is the same curve when
 * performances are evenly spaced.
 */

function utcMs(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Day offsets from opening of each performance, sorted, earlier ones dropped. */
export function perfDaysFor(open, perfs) {
  if (!open || !Array.isArray(perfs)) return [];
  const o = utcMs(open);
  return perfs
    .map(p => (typeof p === 'string' ? p : p?.dt))
    .filter(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p))
    .map(p => Math.round((utcMs(p) - o) / 86400000))
    .filter(d => d >= 0)
    .sort((a, b) => a - b);
}

/**
 * Build the axis for a show. `knots` map a day to progress in [0, 1]; the
 * segments between are linear.
 */
export function buildAxis({ open, perfs, runDays } = {}) {
  const days = perfDaysFor(open, perfs);
  if (days.length) {
    const n = days.length;
    const distinct = [...new Set(days)];
    const knots = distinct.map(D => [D, days.filter(x => x < D).length / n]);
    if (knots[0][0] !== 0) knots.unshift([0, 0]);
    knots.push([distinct[distinct.length - 1] + 1, 1]);
    return { basis: 'performances', n, runDays: distinct[distinct.length - 1], knots };
  }
  const rd = Math.max(1, Math.round(runDays || 1));
  return { basis: 'calendar', n: null, runDays: rd, knots: [[0, 0], [rd, 1]] };
}

function progressAt(knots, d) {
  if (d <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [d0, g0] = knots[i - 1], [d1, g1] = knots[i];
    if (d <= d1) return d1 === d0 ? g1 : g0 + (g1 - g0) * (d - d0) / (d1 - d0);
  }
  return knots[knots.length - 1][1];
}

function dayAtProgress(knots, g) {
  if (g <= knots[0][1]) return knots[0][0];
  for (let i = 1; i < knots.length; i++) {
    const [d0, g0] = knots[i - 1], [d1, g1] = knots[i];
    if (g <= g1) return g1 === g0 ? d1 : d0 + (d1 - d0) * (g - g0) / (g1 - g0);
  }
  return knots[knots.length - 1][0];
}

/** Position on the campaign axis of a given day of the show. */
export function posOfDay(axis, d) {
  if (d <= 0) return d;
  if (!axis?.knots?.length) return d;
  return Math.min(100, progressAt(axis.knots, d) * 100);
}

/** The show's day that sits at a position on the campaign axis. */
export function dayAtPos(axis, x) {
  if (x <= 0) return x;
  if (!axis?.knots?.length) return x;
  return Math.round(dayAtProgress(axis.knots, Math.min(100, x) / 100));
}
