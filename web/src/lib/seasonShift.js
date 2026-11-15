import { quantile, yearOf } from "./stats.js";
import { hasUncertainty, prepare, rng, simulate } from "./uncertainty.js";

// Is the burning season shifting? For each complete calendar year, the days by which 10, 50 and 90 percent of that year's
// detections have happened (the start, middle and end of the burning season), read off the monthly counts.
//
// Limits, all stated on the page:
//  - The counts are monthly, so a date assumes burning is spread evenly inside each month (a non-leap year is used). Dates are
//    good to about a week, and a shift smaller than that cannot be seen in one year.
//  - Estimated years (before VIIRS) get a range from simulated versions of the series (uncertainty.js), but they are NOT used
//    for the trend. The MODIS model has its own ratio for each calendar month, which can by itself move detections between
//    months and fake a shift in timing across the 2012 boundary. The trend uses only years observed by VIIRS.
//  - The range on a trend is the spread of the slope over resamples of those years (bootstrap), so it includes ordinary
//    year-to-year variation, which the simulated ranges do not.

export const MIN_YEAR_TOTAL = 100; // a year with fewer detections than this has no meaningful timing
export const MIN_NATIVE_YEARS = 8; // fewer observed years than this and no trend is offered
export const METRICS = ["start", "mid", "end", "length"];
const FRACTIONS = { start: 0.1, mid: 0.5, end: 0.9 };
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = MONTH_DAYS.map((_, i) => MONTH_DAYS.slice(0, i).reduce((a, b) => a + b, 0));
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Days since 1 January at which `fraction` of the year's detections have happened, assuming even burning inside each month.
function crossing(vals, total, fraction) {
  const target = fraction * total;
  let cum = 0;
  for (let m = 0; m < 12; m++) {
    if (vals[m] > 0 && cum + vals[m] >= target) return MONTH_START[m] + ((target - cum) / vals[m]) * MONTH_DAYS[m];
    cum += vals[m];
  }
  return 365;
}

// vals: the 12 monthly counts of one year. null when the year is too quiet to have a timing.
export function seasonDates(vals) {
  const total = vals.reduce((a, b) => a + b, 0);
  if (!(total >= MIN_YEAR_TOTAL)) return null;
  const start = crossing(vals, total, FRACTIONS.start);
  const mid = crossing(vals, total, FRACTIONS.mid);
  const end = crossing(vals, total, FRACTIONS.end);
  return { start, mid, end, length: end - start };
}

export function dayLabel(days) {
  const d = Math.min(364, Math.max(0, Math.floor(days)));
  let m = 11;
  while (MONTH_START[m] > d) m--;
  return `${d - MONTH_START[m] + 1} ${MONTH_ABBR[m]}`;
}

export function olsSlope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx > 0 ? { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx } : null;
}

function yearGroups(rows) {
  const by = new Map();
  rows.forEach((r, i) => {
    const y = yearOf(r.month);
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(i);
  });
  return [...by.entries()].filter(([, idx]) => idx.length === 12).map(([year, idx]) => ({ year, idx }));
}

const sorted = (a) => Float64Array.from(a).sort();

// Slope of each metric over the observed years, per decade, with the 5th to 95th percentile over resamples of those years.
function trendOf(native, resamples, seed) {
  const rand = rng(seed);
  const out = { from: native[0].year, to: native[native.length - 1].year, n: native.length, metrics: {} };
  for (const k of METRICS) {
    const xs = native.map((y) => y.year);
    const ys = native.map((y) => y.point[k]);
    const fit = olsSlope(xs, ys);
    const slopes = [];
    for (let b = 0; b < resamples; b++) {
      const pick = Array.from({ length: native.length }, () => Math.floor(rand() * native.length));
      const f = olsSlope(pick.map((i) => xs[i]), pick.map((i) => ys[i]));
      if (f) slopes.push(f.slope * 10);
    }
    slopes.sort((a, b) => a - b);
    out.metrics[k] = { perDecade: fit.slope * 10, lo: quantile(slopes, 0.05), hi: quantile(slopes, 0.95), intercept: fit.intercept, slope: fit.slope };
  }
  return out;
}

// rows: aggregateSeries output for the range. Returns { years, trend }: years has the timing of every complete year with
// enough detections (point, and a 10th to 90th percentile range from simulated series for years that contain estimated
// months); trend is null when fewer than MIN_NATIVE_YEARS years were observed by VIIRS.
export function seasonShiftOf(rows, { draws = 1000, resamples = 2000, seed = 20261116 } = {}) {
  const groups = yearGroups(rows);
  if (groups.length === 0) return { years: [], trend: null, nNative: 0 };
  const prep = prepare(rows);
  const point = groups.map((g) => seasonDates(g.idx.map((i) => rows[i].count)));
  const kept = groups.map((g, j) => ({ g, point: point[j] })).filter((x) => x.point);

  const sims = new Map(kept.map(({ g }) => [g.year, Object.fromEntries(METRICS.map((k) => [k, []]))]));
  if (hasUncertainty(prep)) {
    for (const [j, together] of [[0, false], [1, true]]) {
      const rand = rng(seed + j);
      const v = new Float64Array(rows.length);
      for (let d = 0; d < draws; d++) {
        simulate(prep, rand, together, v);
        for (const { g } of kept) {
          if (!g.idx.some((i) => prep[i].kind !== 0)) continue;
          const t = seasonDates(g.idx.map((i) => v[i]));
          if (t) for (const k of METRICS) sims.get(g.year)[k].push(t[k]);
        }
      }
    }
  }
  const years = kept.map(({ g, point: p }) => {
    const estimated = g.idx.some((i) => rows[i].source === "modis_estimated");
    const provisional = g.idx.some((i) => rows[i].provisional);
    const sim = sims.get(g.year);
    const range = (k, q, fallback) => (sim[k].length > 100 ? quantile(sorted(sim[k]), q) : fallback);
    return {
      year: g.year, estimated, provisional, point: p,
      lo: Object.fromEntries(METRICS.map((k) => [k, range(k, 0.1, p[k])])),
      hi: Object.fromEntries(METRICS.map((k) => [k, range(k, 0.9, p[k])])),
    };
  });
  const native = years.filter((y) => !y.estimated && !y.provisional);
  return { years, nNative: native.length, trend: native.length >= MIN_NATIVE_YEARS ? trendOf(native, resamples, seed + 2) : null };
}

// Rows for the chart: the season band (start to end), the middle with its range for estimated years, and the fitted line for
// the middle over the observed years.
export function seasonChartData(shift) {
  const fit = shift.trend?.metrics.mid;
  return shift.years.map((y) => ({
    year: y.year, estimated: y.estimated, start: y.point.start, mid: y.point.mid, end: y.point.end,
    midErr: y.estimated ? [y.point.mid - y.lo.mid, y.hi.mid - y.point.mid] : [0, 0],
    trend: fit && !y.estimated && !y.provisional ? fit.intercept + fit.slope * y.year : null,
  }));
}

export function dayTicks(min, max) {
  return MONTH_START.map((day, i) => ({ day, label: MONTH_ABBR[i] })).filter((t) => t.day >= min && t.day <= max);
}

const PARTS = { start: "the start of the burning season (10% of the year's detections)", mid: "the middle (half of the year's detections)", end: "the end (90%)", length: "the length between start and end" };
const days = (x) => `${Math.abs(x).toFixed(1)} ${Math.abs(x).toFixed(1) === "1.0" ? "day" : "days"}`;
const signed = (x) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}`;

function phrase(m, later, earlier) {
  if (m.lo > 0) return `${later} by about ${days(m.perDecade)} per decade (90% range ${signed(m.lo)} to ${signed(m.hi)})`;
  if (m.hi < 0) return `${earlier} by about ${days(m.perDecade)} per decade (90% range ${signed(m.lo)} to ${signed(m.hi)})`;
  return `shows no clear shift (${signed(m.perDecade)} days per decade, 90% range ${signed(m.lo)} to ${signed(m.hi)})`;
}

// Plain-language reading of the trend. A shift is called only when the whole 90% range is on one side of zero.
export function seasonShiftText(shift) {
  if (!shift || shift.years.length === 0) return null;
  if (!shift.trend) {
    return `Only ${shift.nNative} ${shift.nNative === 1 ? "year" : "years"} in this range were observed by VIIRS; a trend needs at least ${MIN_NATIVE_YEARS}, so none is drawn. Choose a longer range that reaches back to 2012 or earlier.`;
  }
  const t = shift.trend;
  const m = t.metrics;
  return `Across the ${t.n} years observed by VIIRS (${t.from} to ${t.to}), ${PARTS.mid} ${phrase(m.mid, "moved later", "moved earlier")}; `
    + `${PARTS.start} ${phrase(m.start, "moved later", "moved earlier")}; ${PARTS.end} ${phrase(m.end, "moved later", "moved earlier")}.`
    + ` The season ${m.length.lo > 0 ? `grew longer by about ${days(m.length.perDecade)} per decade` : m.length.hi < 0 ? `got shorter by about ${days(m.length.perDecade)} per decade` : "shows no clear change in length"}.`;
}

export const SEASON_NOTE = "Each date is the day by which that share of the year's detections had happened, worked out from monthly counts with burning assumed even inside each month, so it is good to about a week. "
  + "Hollow dots are years estimated from MODIS; their bars are the 10 to 90 percent range from simulated series. They are shown for context and left out of the trend: "
  + "the MODIS model uses a different ratio for each calendar month, which can move detections between months and fake a shift across 2012. "
  + "The trend range is the 5th to 95th percentile of the slope over resamples of the observed years, so it includes ordinary year-to-year variation.";
