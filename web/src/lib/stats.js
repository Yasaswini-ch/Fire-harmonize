// Pure statistics over aggregateSeries output: [{ month: "YYYY-MM", count, lo, hi, source, provisional }].
// Months are 1..12 in every result. Nothing here is exact: estimated months carry lo/hi, and
// baselines built from them inherit that uncertainty (they use the point estimate `count`).

export const yearOf = (month) => Number(month.slice(0, 4));
export const monthOf = (month) => Number(month.slice(5, 7));

// Linear-interpolated quantile of an ascending array (same as numpy's default).
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Median, p25 and p75 of each calendar month across baseline years startYear..endYear. The "current"
// year is left out so a month is never compared with a baseline that contains itself: by default it is
// the year of the last month in `series`; pass excludeYear to override (e.g. the year of a range end).
export function monthlyMedianBaseline(series, startYear, endYear, excludeYear) {
  const skip = excludeYear ?? (series.length ? yearOf(series[series.length - 1].month) : null);
  const buckets = Array.from({ length: 12 }, () => []);
  for (const r of series) {
    const y = yearOf(r.month);
    if (y < startYear || y > endYear || y === skip) continue;
    buckets[monthOf(r.month) - 1].push(r.count);
  }
  return buckets.map((b, i) => {
    const values = [...b].sort((x, y) => x - y);
    return { month: i + 1, n: values.length, values, median: quantile(values, 0.5), p25: quantile(values, 0.25), p75: quantile(values, 0.75) };
  });
}

// How many baseline years the baseline really rests on.
export const baselineYearCount = (baseline) => Math.max(0, ...baseline.map((b) => b.n));

export function percentileLabel(p) {
  if (p < 10) return "well below";
  if (p < 35) return "below";
  if (p <= 65) return "near";
  if (p <= 90) return "above";
  return "well above";
}

// Latest month of `series` against the baseline's median for the same calendar month.
// percentile = share of baseline years below the value, counting ties as half.
export function currentMonthComparison(series, baseline) {
  const latest = series[series.length - 1];
  if (!latest) return null;
  const b = baseline[monthOf(latest.month) - 1];
  const out = {
    month: latest.month, count: latest.count, lo: latest.lo, hi: latest.hi,
    source: latest.source, provisional: latest.provisional,
    baselineMedian: b.median, baselineYears: b.n, yearsBelow: null,
    ratio: null, percentDiff: null, percentDiffLo: null, percentDiffHi: null, percentile: null, label: null,
  };
  if (b.n === 0) return out;
  const below = b.values.filter((v) => v < latest.count).length;
  const equal = b.values.filter((v) => v === latest.count).length;
  out.yearsBelow = below; // baseline years with fewer detections than this month
  out.percentile = (100 * (below + equal / 2)) / b.n;
  out.label = percentileLabel(out.percentile);
  if (b.median > 0) {
    out.ratio = latest.count / b.median;
    out.percentDiff = (out.ratio - 1) * 100;
    out.percentDiffLo = (latest.lo / b.median - 1) * 100;
    out.percentDiffHi = (latest.hi / b.median - 1) * 100;
  }
  return out;
}

// Calendar years with all 12 months present. lo/hi are sums of monthly lo/hi (they assume the monthly
// errors move together, so the interval is wide on purpose).
export function annualTotals(series) {
  const byYear = new Map();
  for (const r of series) {
    const y = yearOf(r.month);
    if (!byYear.has(y)) byYear.set(y, { year: y, total: 0, lo: 0, hi: 0, months: 0, estimated: false, provisional: false });
    const t = byYear.get(y);
    t.total += r.count; t.lo += r.lo; t.hi += r.hi; t.months += 1;
    t.estimated ||= r.source === "modis_estimated";
    t.provisional ||= r.provisional;
  }
  return [...byYear.values()].filter((t) => t.months === 12).sort((a, b) => a.year - b.year);
}

// z-score of each complete year in `series` against the mean and sample sd (n - 1) of the annual totals
// in startYear..endYear, taken from baselineSeries (defaults to `series`). z is null when the baseline
// has fewer than 2 years or no spread. flag is |z| > 2.
export function anomalyZ(series, startYear, endYear, baselineSeries = series) {
  const base = annualTotals(baselineSeries).filter((t) => t.year >= startYear && t.year <= endYear);
  const n = base.length;
  const mean = n ? base.reduce((a, t) => a + t.total, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(base.reduce((a, t) => a + (t.total - mean) ** 2, 0) / (n - 1)) : null;
  const years = annualTotals(series).map((t) => {
    const z = sd > 0 ? (t.total - mean) / sd : null;
    return { ...t, z, flag: z !== null && Math.abs(z) > 2 };
  });
  return { baselineYears: n, mean, sd, years };
}

const byCountDesc = (a, b) => b.count - a.count || a.month.localeCompare(b.month);
export const topMonths = (series, n) => [...series].sort(byCountDesc).slice(0, n);
// Complete calendar years only, highest total first.
export const topYears = (series, n) => annualTotals(series).sort((a, b) => b.total - a.total || a.year - b.year).slice(0, n);

// Shortest run of consecutive calendar months (wrapping Dec to Jan) whose baseline medians add up to
// at least 80% of the sum of all twelve medians. Ties on length go to the run with the larger share.
// Returns null when the baseline is empty or has no detections.
export function fireSeasonWindow(series, startYear, endYear, excludeYear) {
  const med = monthlyMedianBaseline(series, startYear, endYear, excludeYear).map((b) => b.median ?? 0);
  const total = med.reduce((a, v) => a + v, 0);
  if (total <= 0) return null;
  const peakMonth = med.indexOf(Math.max(...med)) + 1;
  for (let length = 1; length <= 12; length++) {
    let best = null;
    for (let s = 0; s < 12; s++) {
      let sum = 0;
      for (let k = 0; k < length; k++) sum += med[(s + k) % 12];
      if (sum >= 0.8 * total - 1e-9 && (!best || sum > best.sum)) best = { s, sum };
    }
    if (best) {
      return {
        startMonth: best.s + 1, length, share: best.sum / total, peakMonth, profileTotal: total,
        months: Array.from({ length }, (_, k) => ((best.s + k) % 12) + 1),
      };
    }
  }
  return null;
}
