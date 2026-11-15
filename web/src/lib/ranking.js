import { monthLabel } from "./format.js";
import { topMonths, yearOf } from "./stats.js";
import { hasUncertainty, prepare, rng, simulate } from "./uncertainty.js";

// How sure is the ranking? The busiest month, the busiest year and the five highest months are read off point estimates, but
// months before VIIRS are estimates with a range. This re-runs the ranking on simulated versions of the series (see
// uncertainty.js) and reports how often each candidate comes out on top.

export const DRAWS = 2000; // per assumption (errors independent, errors together)
const SEED = 20261115;
const MIN_SHOWN = 0.02; // candidates that win less often than this are not listed
const TOP_K = 5;

export const RANKING_NOTE = `Chances come from ${DRAWS.toLocaleString("en-US")} simulated versions of the series for each of two assumptions: the errors of the estimated months are independent, `
  + "or they all move together. Each estimated month is drawn from a curve through its stated 10 to 90 percent range; observed months are not varied. "
  + "A range such as 62% to 71% is the spread between the two assumptions. Provisional months can still change and are not varied.";

function yearGroups(rows) {
  const by = new Map();
  rows.forEach((r, i) => {
    const y = yearOf(r.month);
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(i);
  });
  return [...by.entries()].filter(([, idx]) => idx.length === 12).map(([year, idx]) => ({ year, idx }));
}

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

// The indices of the k largest values, largest first, found in one pass (a full sort of every draw was the slow part). Equal
// values keep the earlier month first, as a stable sort would.
function topIndices(v, k, out) {
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (n === k && x <= v[out[k - 1]]) continue;
    let j = n < k ? n++ : k - 1;
    while (j > 0 && v[out[j - 1]] < x) { out[j] = out[j - 1]; j--; }
    out[j] = i;
  }
  return n;
}

function tally(prep, years, together, draws, seed) {
  const rand = rng(seed);
  const v = new Float64Array(prep.length);
  const top = new Int32Array(TOP_K);
  const monthWins = new Map();
  const yearWins = new Map();
  const inTop = new Map();
  for (let d = 0; d < draws; d++) {
    simulate(prep, rand, together, v);
    const n = topIndices(v, TOP_K, top);
    bump(monthWins, top[0]);
    for (let k = 0; k < n; k++) bump(inTop, top[k]);
    let best = null;
    let bestTotal = -Infinity;
    for (const g of years) {
      let s = 0;
      for (const i of g.idx) s += v[i];
      if (s > bestTotal) { bestTotal = s; best = g.year; }
    }
    if (best !== null) bump(yearWins, best);
  }
  return { monthWins, yearWins, inTop };
}

// Chance of each candidate under the two assumptions: pLow and pHigh are the smaller and larger of the two.
const span = (a, b, key, draws) => {
  const p = (m) => (m.get(key) ?? 0) / draws;
  return { pLow: Math.min(p(a), p(b)), pHigh: Math.max(p(a), p(b)) };
};
const keysOf = (a, b) => new Set([...a.keys(), ...b.keys()]);

// rows: aggregateSeries output for the range. Returns { uncertain: false } when no month in the range is estimated (every
// ranking is then exact as observed), otherwise the leading candidates for busiest month and year, and for each of the
// five highest months its chance of really being in the top five. null for an empty range.
export function rankingOf(rows, { draws = DRAWS, seed = SEED } = {}) {
  if (rows.length === 0) return null;
  const prep = prepare(rows);
  if (!hasUncertainty(prep)) return { uncertain: false };
  const years = yearGroups(rows);
  const [a, b] = [false, true].map((together, j) => tally(prep, years, together, draws, seed + j));
  const leaders = (aMap, bMap, name) => [...keysOf(aMap, bMap)]
    .map((key) => ({ ...name(key), ...span(aMap, bMap, key, draws) }))
    .filter((c) => c.pHigh >= MIN_SHOWN)
    .sort((x, y) => y.pHigh - x.pHigh || y.pLow - x.pLow)
    .slice(0, 3);
  const index = new Map(rows.map((r, i) => [r.month, i]));
  return {
    uncertain: true, drawsPerAssumption: draws,
    month: leaders(a.monthWins, b.monthWins, (i) => ({ month: rows[i].month })),
    year: leaders(a.yearWins, b.yearWins, (y) => ({ year: y })),
    topFive: topMonths(rows, TOP_K).map((r) => ({ month: r.month, ...span(a.inTop, b.inTop, index.get(r.month), draws) })),
  };
}

export const share = (c) => {
  const lo = Math.round(c.pLow * 100);
  const hi = Math.round(c.pHigh * 100);
  return lo === hi ? `${lo}%` : `${lo}% to ${hi}%`;
};

// A sentence about the leading candidate, or null when there is nothing to add. what: "month" or "year". name: candidate -> text.
export function leaderText(candidates, what, name) {
  if (!candidates || candidates.length === 0) return null;
  const [first, second] = candidates;
  if (first.pLow >= 0.995) return `No estimated ${what} comes close enough to change this.`;
  return `${name(first)} is the busiest ${what} in ${share(first)} of draws within the stated ranges${second ? `; next is ${name(second)} (${share(second)})` : ""}.`;
}

// The shakiest members of the top five, or null when every one is nearly certain.
export function topFiveText(topFive) {
  const shaky = (topFive ?? []).filter((c) => c.pLow < 0.99).sort((x, y) => x.pLow - y.pLow).slice(0, 3);
  if (shaky.length === 0) return null;
  return `Chance of really being among the five highest months: ${shaky.map((c) => `${monthLabel(c.month)} ${share(c)}`).join("; ")}.`;
}
