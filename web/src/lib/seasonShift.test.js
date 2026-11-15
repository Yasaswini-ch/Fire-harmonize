import { describe, expect, it } from "vitest";
import { dayLabel, dayTicks, MIN_NATIVE_YEARS, olsSlope, seasonChartData, seasonDates, seasonShiftOf, seasonShiftText } from "./seasonShift.js";

describe("seasonDates", () => {
  it("finds where 10, 50 and 90 percent of an even year have happened", () => {
    const d = seasonDates(new Array(12).fill(10));
    expect(d.start).toBeCloseTo(31 + 0.2 * 28, 6); // 12 of 120 falls 20% into February
    expect(d.mid).toBeCloseTo(181, 6); // exactly the end of June
    expect(d.end).toBeCloseTo(304 + 0.8 * 30, 6); // 108 of 120 falls 80% into November
    expect(d.length).toBeCloseTo(d.end - d.start, 9);
  });
  it("places a one-month season inside that month", () => {
    const v = new Array(12).fill(0);
    v[6] = 100; // July, which starts on day 181
    const d = seasonDates(v);
    expect(d.start).toBeCloseTo(181 + 0.1 * 31, 6);
    expect(d.mid).toBeCloseTo(181 + 0.5 * 31, 6);
    expect(d.end).toBeCloseTo(181 + 0.9 * 31, 6);
  });
  it("has no timing for a year that is too quiet", () => {
    expect(seasonDates(new Array(12).fill(5))).toBeNull();
  });
});

describe("labels and fits", () => {
  it("turns days since 1 January into a date", () => {
    expect(dayLabel(0)).toBe("1 Jan");
    expect(dayLabel(181)).toBe("1 Jul");
    expect(dayLabel(196.5)).toBe("16 Jul");
    expect(dayLabel(400)).toBe("31 Dec");
  });
  it("fits a straight line", () => {
    const f = olsSlope([2012, 2013, 2014, 2015], [5, 7, 9, 11]);
    expect(f.slope).toBeCloseTo(2, 9);
    expect(olsSlope([2012, 2012], [1, 2])).toBeNull();
  });
  it("offers month starts as axis ticks inside the range", () => {
    expect(dayTicks(150, 250).map((t) => t.label)).toEqual(["Jun", "Jul", "Aug", "Sep"]);
  });
});

// A Gaussian burning season centred `centre` months into the year, 1000 detections at the peak.
const profile = (centre) => Array.from({ length: 12 }, (_, m) => Math.round(1000 * Math.exp(-((m + 0.5 - centre) ** 2) / (2 * 1.5 ** 2))));
const series = (from, to, drift, estimatedBefore = 2012) => {
  const rows = [];
  for (let y = from; y <= to; y++) {
    const p = profile(7 + drift * (y - 2012));
    p.forEach((count, m) => {
      const est = y < estimatedBefore;
      rows.push({ month: `${y}-${String(m + 1).padStart(2, "0")}`, count, lo: est ? count * 0.6 : count, hi: est ? count * 1.6 : count, source: est ? "modis_estimated" : "viirs_native", provisional: false });
    });
  }
  return rows;
};

describe("seasonShiftOf", () => {
  const shift = seasonShiftOf(series(2002, 2025, 0.02));
  it("times every complete year and flags the estimated ones", () => {
    expect(shift.years).toHaveLength(24);
    expect(shift.years.filter((y) => y.estimated)).toHaveLength(10);
    expect(shift.nNative).toBe(14);
  });
  it("gives estimated years a range around the point and observed years none", () => {
    const est = shift.years.find((y) => y.year === 2005);
    expect(est.lo.mid).toBeLessThanOrEqual(est.point.mid);
    expect(est.hi.mid).toBeGreaterThanOrEqual(est.point.mid);
    expect(est.hi.mid - est.lo.mid).toBeGreaterThan(0.3);
    const obs = shift.years.find((y) => y.year === 2018);
    expect(obs.lo.mid).toBe(obs.point.mid);
    expect(obs.hi.mid).toBe(obs.point.mid);
  });
  it("recovers a known drift from the observed years only", () => {
    const m = shift.trend.metrics.mid;
    expect(shift.trend).toMatchObject({ from: 2012, to: 2025, n: 14 });
    expect(m.perDecade).toBeGreaterThan(5);
    expect(m.perDecade).toBeLessThan(7); // 0.02 months a year is about 6 days a decade
    expect(m.lo).toBeGreaterThan(0);
  });
  it("is not fooled by estimated years that are timed differently", () => {
    // Estimated years peak a month earlier than observed ones, with no drift in the observed years.
    const rows = [...series(2002, 2011, 0, 2012).map((r) => ({ ...r })), ...series(2012, 2025, 0, 2012)];
    const earlier = rows.map((r) => (r.source === "modis_estimated" ? { ...r, count: profile(6)[Number(r.month.slice(5)) - 1] } : r));
    const s = seasonShiftOf(earlier);
    expect(Math.abs(s.trend.metrics.mid.perDecade)).toBeLessThan(0.5);
    expect(s.trend.metrics.mid.lo).toBeLessThanOrEqual(0.5);
    expect(s.trend.metrics.mid.hi).toBeGreaterThanOrEqual(-0.5);
  });
  it("is the same every time", () => {
    expect(seasonShiftOf(series(2002, 2025, 0.02))).toEqual(shift);
  });
  it("offers no trend with too few observed years", () => {
    const few = seasonShiftOf(series(2008, 2016, 0.02));
    expect(few.nNative).toBe(5);
    expect(few.nNative).toBeLessThan(MIN_NATIVE_YEARS);
    expect(few.trend).toBeNull();
    expect(seasonShiftText(few)).toContain("a trend needs at least 8");
  });
  it("skips incomplete years and returns nothing for an empty range", () => {
    expect(seasonShiftOf(series(2012, 2013, 0).slice(3)).years).toHaveLength(1);
    expect(seasonShiftOf([])).toEqual({ years: [], trend: null, nNative: 0 });
  });
});

describe("seasonShiftText and chart rows", () => {
  it("calls a shift only when the whole 90% range is on one side of zero", () => {
    const t = seasonShiftText(seasonShiftOf(series(2002, 2025, 0.02)));
    expect(t).toContain("14 years observed by VIIRS (2012 to 2025)");
    expect(t).toContain("moved later by about");
  });
  it("says there is no clear shift when there is none", () => {
    const t = seasonShiftText(seasonShiftOf(series(2002, 2025, 0)));
    expect(t).toContain("shows no clear shift");
    expect(t).toContain("shows no clear change in length");
  });
  it("draws the fitted line only over observed years", () => {
    const rows = seasonChartData(seasonShiftOf(series(2002, 2025, 0.02)));
    expect(rows.find((r) => r.year === 2005).trend).toBeNull();
    expect(rows.find((r) => r.year === 2020).trend).not.toBeNull();
    expect(rows.find((r) => r.year === 2005).midErr[0]).toBeGreaterThan(0);
    expect(rows.find((r) => r.year === 2020).midErr).toEqual([0, 0]);
  });
});
