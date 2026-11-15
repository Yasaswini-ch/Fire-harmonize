import { describe, expect, it } from "vitest";
import {
  annualTotals, anomalyZ, baselineYearCount, currentMonthComparison, fireSeasonWindow,
  monthlyMedianBaseline, percentileLabel, quantile, topMonths, topYears,
} from "./stats.js";

// Hand-made fixture. Every year follows PROFILE scaled by a factor, so the right answers are known:
//   2001 x0.5 (total 50), 2002 x1 (100), 2003 x1 (100), 2004 x1.5 (150), 2005 x3 (300).
const PROFILE = [0, 0, 0, 0, 10, 20, 40, 20, 10, 0, 0, 0];
const FACTORS = { 2001: 0.5, 2002: 1, 2003: 1, 2004: 1.5, 2005: 3 };
const pad = (m) => String(m).padStart(2, "0");

function build(profile = PROFILE, factors = FACTORS) {
  const rows = [];
  for (const [year, f] of Object.entries(factors)) {
    profile.forEach((v, i) => {
      rows.push({ month: `${year}-${pad(i + 1)}`, count: v * f, lo: v * f, hi: v * f, source: "viirs_native", provisional: false });
    });
  }
  return rows;
}
const series = build();
const upTo = (rows, month) => rows.filter((r) => r.month <= month);
const row = (month, count, extra = {}) => ({ month, count, lo: count, hi: count, source: "viirs_native", provisional: false, ...extra });

describe("quantile", () => {
  it("interpolates linearly", () => {
    expect(quantile([20, 40, 40, 60], 0.25)).toBe(35);
    expect(quantile([20, 40, 40, 60], 0.5)).toBe(40);
    expect(quantile([7], 0.75)).toBe(7);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe("monthlyMedianBaseline", () => {
  it("gives median, p25 and p75 per calendar month and excludes the current (latest) year", () => {
    const b = monthlyMedianBaseline(series, 2001, 2005);
    expect(b).toHaveLength(12);
    expect(b[6]).toMatchObject({ month: 7, n: 4, median: 40, p25: 35, p75: 45, values: [20, 40, 40, 60] }); // 2005 (120) left out
    expect(b[5]).toMatchObject({ median: 20, p25: 17.5, p75: 22.5 });
    expect(b[0]).toMatchObject({ median: 0, p25: 0, p75: 0 });
  });
  it("respects the baseline years and an explicit excluded year", () => {
    expect(monthlyMedianBaseline(series, 2002, 2003)[6].values).toEqual([40, 40]);
    expect(monthlyMedianBaseline(series, 2001, 2005, 2001)[6].values).toEqual([40, 40, 60, 120]);
  });
  it("reports null stats for a month with no baseline data", () => {
    const b = monthlyMedianBaseline(upTo(series, "2001-12"), 2001, 2005); // only the excluded year exists
    expect(b[6]).toMatchObject({ n: 0, median: null });
    expect(baselineYearCount(b)).toBe(0);
    expect(baselineYearCount(monthlyMedianBaseline(series, 2001, 2005))).toBe(4);
  });
});

describe("currentMonthComparison", () => {
  const baseline = monthlyMedianBaseline(series, 2001, 2005); // July: [20, 40, 40, 60]
  it("compares the latest month with the median of the same calendar month", () => {
    const c = currentMonthComparison(upTo(series, "2005-07"), baseline); // July 2005 = 120
    expect(c).toMatchObject({ month: "2005-07", count: 120, baselineMedian: 40, baselineYears: 4, ratio: 3, percentDiff: 200, percentile: 100, label: "well above" });
  });
  it("maps percentile rank to labels at the 10, 35, 65 and 90 thresholds", () => {
    const at = (count) => currentMonthComparison([row("2005-07", count)], baseline);
    expect(at(5)).toMatchObject({ percentile: 0, label: "well below" });
    expect(at(30)).toMatchObject({ percentile: 25, label: "below" });
    expect(at(40)).toMatchObject({ percentile: 50, label: "near" }); // two ties count half each
    expect(at(50)).toMatchObject({ percentile: 75, label: "above" });
    expect(at(60)).toMatchObject({ percentile: 87.5, label: "above" });
    expect(at(61)).toMatchObject({ percentile: 100, label: "well above" });
    expect([9.9, 10, 34.9, 35, 65, 65.1, 90, 90.1].map(percentileLabel))
      .toEqual(["well below", "below", "below", "near", "near", "above", "above", "well above"]);
  });
  it("carries the provisional flag, the source and an interval from lo/hi", () => {
    const latest = row("2005-07", 60, { lo: 50, hi: 100, source: "modis_estimated", provisional: true });
    const c = currentMonthComparison([latest], baseline);
    expect(c).toMatchObject({ provisional: true, source: "modis_estimated", lo: 50, hi: 100, percentDiff: 50 });
    expect(c.percentDiffLo).toBeCloseTo(25, 10);
    expect(c.percentDiffHi).toBeCloseTo(150, 10);
  });
  it("does not divide by a zero baseline and handles a month with no baseline", () => {
    const jan = currentMonthComparison([row("2005-01", 5)], baseline); // baseline January median is 0
    expect(jan).toMatchObject({ baselineMedian: 0, ratio: null, percentDiff: null, label: "well above" });
    const none = currentMonthComparison([row("2001-07", 5)], monthlyMedianBaseline(upTo(series, "2001-12"), 2001, 2005));
    expect(none).toMatchObject({ baselineYears: 0, label: null, percentile: null });
    expect(currentMonthComparison([], baseline)).toBeNull();
  });
});

describe("annualTotals", () => {
  it("sums complete years and drops partial ones", () => {
    expect(annualTotals(series).map((t) => [t.year, t.total])).toEqual([[2001, 50], [2002, 100], [2003, 100], [2004, 150], [2005, 300]]);
    expect(annualTotals(upTo(series, "2005-11")).map((t) => t.year)).toEqual([2001, 2002, 2003, 2004]);
    expect(annualTotals(series.slice(3, 17))).toEqual([]); // 14 months, no full calendar year
  });
  it("sums lo/hi and flags estimated and provisional years", () => {
    const rows = series.slice(0, 12).map((r) => ({ ...r, lo: r.count * 0.5, hi: r.count * 2, source: "modis_estimated", provisional: r.month === "2001-12" }));
    expect(annualTotals(rows)[0]).toMatchObject({ year: 2001, total: 50, lo: 25, hi: 100, estimated: true, provisional: true });
  });
});

describe("anomalyZ", () => {
  it("scores annual totals against the baseline mean and sample sd, and flags |z| > 2", () => {
    const { mean, sd, baselineYears, years } = anomalyZ(series, 2001, 2004); // totals 50, 100, 100, 150
    expect(baselineYears).toBe(4);
    expect(mean).toBe(100);
    expect(sd).toBeCloseTo(Math.sqrt(5000 / 3), 10);
    const z = Object.fromEntries(years.map((y) => [y.year, y]));
    expect(z[2001].z).toBeCloseTo(-50 / sd, 10);
    expect(z[2002].z).toBe(0);
    expect(z[2004].z).toBeCloseTo(50 / sd, 10);
    expect(z[2005].z).toBeCloseTo(200 / sd, 10);
    expect(years.map((y) => y.flag)).toEqual([false, false, false, false, true]);
  });
  it("can take the baseline from a longer series than the one being scored", () => {
    const { years } = anomalyZ(series.slice(-24), 2001, 2004, series); // score 2004-2005 only
    expect(years.map((y) => y.year)).toEqual([2004, 2005]);
    expect(years[1].z).toBeCloseTo(200 / Math.sqrt(5000 / 3), 10);
  });
  it("gives null z, never NaN, when the baseline has no spread or fewer than 2 years", () => {
    expect(anomalyZ(series, 2002, 2003).years.every((y) => y.z === null && !y.flag)).toBe(true); // 100, 100
    expect(anomalyZ(series, 2002, 2002).years.every((y) => y.z === null)).toBe(true);
    expect(anomalyZ(series, 1990, 1991)).toMatchObject({ baselineYears: 0, mean: null, sd: null });
  });
});

describe("topMonths and topYears", () => {
  it("rank by count, breaking ties by earlier month", () => {
    expect(topMonths(series, 1).map((r) => r.month)).toEqual(["2005-07"]);
    // 120, then three-way tie at 60 (2004-07, 2005-06, 2005-08) resolved by earlier month
    expect(topMonths(series, 4).map((r) => r.month)).toEqual(["2005-07", "2004-07", "2005-06", "2005-08"]);
    expect(topMonths(series, 500)).toHaveLength(series.length);
    expect(series.length).toBe(60); // topMonths did not reorder the input
    expect(series[0].month).toBe("2001-01");
  });
  it("rank complete years only", () => {
    expect(topYears(series, 2).map((t) => [t.year, t.total])).toEqual([[2005, 300], [2004, 150]]);
    expect(topYears(upTo(series, "2005-12").concat([row("2006-01", 9999)]), 1)[0].year).toBe(2005); // 2006 is partial
  });
});

describe("fireSeasonWindow", () => {
  it("finds the shortest run holding 80% of the median profile, and the peak", () => {
    // medians: May 10, Jun 20, Jul 40, Aug 20, Sep 10 (total 100). Jun-Aug = 80, no 2-month run reaches 80.
    const w = fireSeasonWindow(series, 2001, 2004);
    expect(w).toMatchObject({ startMonth: 6, length: 3, months: [6, 7, 8], peakMonth: 7, profileTotal: 100 });
    expect(w.share).toBeCloseTo(0.8, 10);
  });
  it("wraps across the year end", () => {
    // medians: Jan 20, Feb 10, Oct 10, Nov 20, Dec 40. Nov-Jan = 80.
    const wrap = build([20, 10, 0, 0, 0, 0, 0, 0, 0, 10, 20, 40]).concat([row("2006-01", 1)]); // 2006 is the excluded current year
    const w = fireSeasonWindow(wrap, 2001, 2005);
    expect(w).toMatchObject({ startMonth: 11, length: 3, months: [11, 12, 1], peakMonth: 12 });
  });
  it("uses a single month when one month holds 80%, and the whole year when needed", () => {
    expect(fireSeasonWindow(build([0, 0, 0, 0, 0, 0, 90, 10, 0, 0, 0, 0]), 2001, 2004)).toMatchObject({ length: 1, months: [7], share: 0.9 });
    const flat = fireSeasonWindow(build(Array(12).fill(10)), 2001, 2004); // 80% of 12 equal months = 9.6 -> 10 months
    expect(flat.length).toBe(10);
  });
  it("is null when the baseline has no detections", () => {
    expect(fireSeasonWindow(build(Array(12).fill(0)), 2001, 2004)).toBeNull();
    expect(fireSeasonWindow([], 2001, 2004)).toBeNull();
  });
});
