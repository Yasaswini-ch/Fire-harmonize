// Simulated versions of a monthly series, for questions that depend on the ranges of the estimated months (which month or
// year was busiest, when the burning season falls). Pure, no React, deterministic for a given seed.
//
// What a "draw" is. Observed (VIIRS) months are left as they are. Each MODIS-estimated month is replaced by a value from a
// log-normal curve passed through its stated 10th and 90th percentile (the row's lo and hi), so the draws agree with the
// ranges drawn on the calendar. Two assumptions bracket how the errors of different months relate:
//   independent  every estimated month errs on its own
//   together     all estimated months err in the same direction by the same number of standard deviations
// (the annual ranges in stats.js use "together"). The truth is somewhere between, so callers report both.
// Provisional months are not varied: their size can still change, and that is flagged elsewhere.

export const Z90 = 1.2815515655446004; // the 90th percentile of the standard normal curve

// mulberry32: a small seeded random generator, so the same data always gives the same answer.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

// Per month: how to draw it. kind 0 = as observed; 1 = log-normal through lo..hi; 2 = a month estimated as zero or with a range
// that starts at 0 (a log-normal cannot start there), drawn evenly between lo and hi.
export function prepare(rows) {
  return rows.map((r) => {
    if (r.source !== "modis_estimated" || !(r.hi > r.lo)) return { kind: 0, v: r.count };
    if (r.count > 0 && r.lo > 0) {
      return { kind: 1, mu: (Math.log(r.lo) + Math.log(r.hi)) / 2, sigma: (Math.log(r.hi) - Math.log(r.lo)) / (2 * Z90) };
    }
    return { kind: 2, lo: r.lo, hi: r.hi };
  });
}

export const hasUncertainty = (prep) => prep.some((p) => p.kind !== 0);

// One simulated series. together: all estimated months share one random number.
export function simulate(prep, rand, together, out = new Float64Array(prep.length)) {
  const shared = together ? gauss(rand) : 0;
  for (let i = 0; i < prep.length; i++) {
    const p = prep[i];
    out[i] = p.kind === 0 ? p.v : p.kind === 1 ? Math.exp(p.mu + p.sigma * (together ? shared : gauss(rand))) : p.lo + (p.hi - p.lo) * rand();
  }
  return out;
}
