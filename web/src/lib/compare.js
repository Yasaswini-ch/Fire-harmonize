// Side-by-side figures for two areas of the same region, from the same monthly series the rest of the app uses.
// Pure, no React. Nothing here is exact: estimated months carry ranges, and the totals add those ranges up.
import { annualTotals, anomalyZ, baselineYearCount, currentMonthComparison, fireSeasonWindow, monthlyMedianBaseline, topMonths, yearOf } from "./stats.js";

// Pearson correlation of two equal-length arrays; null when there are under 5 pairs or either has no spread.
export function pearson(a, b) {
  const n = a.length;
  if (n < 5 || b.length !== n) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

// One area: full = its whole monthly series, start/end = the selected months (YYYY-MM).
export function summarizeArea(full, start, end) {
  const rows = full.filter((r) => r.month >= start && r.month <= end);
  if (rows.length === 0) return null;
  const complete = annualTotals(full).map((t) => t.year);
  const exclude = yearOf(rows[rows.length - 1].month);
  const baseline = complete.length ? monthlyMedianBaseline(full, complete[0], complete[complete.length - 1], exclude) : null;
  const season = baseline ? fireSeasonWindow(full, complete[0], complete[complete.length - 1], exclude) : null;
  const medians = baseline ? baseline.map((b) => b.median ?? 0) : null;
  const medianTotal = medians ? medians.reduce((a, v) => a + v, 0) : 0;
  const peak = topMonths(rows, 1)[0];
  return {
    rows,
    total: rows.reduce((a, r) => a + r.count, 0),
    lo: rows.reduce((a, r) => a + r.lo, 0),
    hi: rows.reduce((a, r) => a + r.hi, 0),
    estimatedMonths: rows.filter((r) => r.source === "modis_estimated").length,
    peak,
    season,
    comparison: baseline ? currentMonthComparison(rows, baseline) : null,
    baselineYears: baseline ? baselineYearCount(baseline) : 0,
    anomaly: baseline && rows.length >= 12 ? anomalyZ(rows, complete[0], complete[complete.length - 1], full) : null,
    // each calendar month's share of the typical annual total, in percent: comparable between areas of different size
    seasonShare: medianTotal > 0 ? medians.map((v) => (100 * v) / medianTotal) : null,
    annual: annualTotals(rows),
  };
}

// Do the two areas burn in the same years? Correlation of the annual totals of the years both have, and the years
// each area flags as unusual (beyond 2 standard deviations) in common.
export function sameYears(a, b) {
  const bm = new Map(b.annual.map((t) => [t.year, t.total]));
  const shared = a.annual.filter((t) => bm.has(t.year));
  const r = pearson(shared.map((t) => t.total), shared.map((t) => bm.get(t.year)));
  return { years: shared.length, correlation: r };
}

// [{ year, a, b }] z-scores for the chart; a year is left out when either z is undefined.
export function anomalyPairs(a, b) {
  if (!a.anomaly || !b.anomaly) return [];
  const bz = new Map(b.anomaly.years.map((y) => [y.year, y.z]));
  return a.anomaly.years.filter((y) => y.z !== null && bz.get(y.year) != null).map((y) => ({ year: y.year, a: y.z, b: bz.get(y.year) }));
}

// What the correlation of annual totals means in words. It describes a pattern of years, not a cause.
export function correlationText(r, years, estimatedShared) {
  if (r === null) return "Fewer than 5 complete years in common, or no year-to-year change, so the busy years cannot be compared.";
  const word = r >= 0.7 ? "tend to burn in the same years" : r <= 0.3 ? "are largely independent in which years burn" : "partly share their busy years";
  return `Over ${years} shared complete years the annual totals have a correlation of ${r.toFixed(2)}: the two areas ${word}.`
    + (estimatedShared ? " Years before VIIRS use the same MODIS model for both areas, which can make them look more alike than they are." : "");
}
