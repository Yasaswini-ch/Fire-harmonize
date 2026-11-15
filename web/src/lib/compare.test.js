import { describe, expect, it } from "vitest";
import { anomalyPairs, correlationText, pearson, sameYears, summarizeArea } from "./compare.js";

const PROFILE = [0, 0, 0, 0, 10, 20, 40, 20, 10, 0, 0, 0];
function series(scale, shift = 0) {
  const rows = [];
  for (let y = 2001; y <= 2012; y++) {
    PROFILE.forEach((v, i) => {
      const count = v * scale * (1 + ((y + shift) % 4) * 0.25);
      rows.push({ month: `${y}-${String(i + 1).padStart(2, "0")}`, count, lo: count, hi: count, source: "viirs_native", provisional: false });
    });
  }
  return rows;
}

describe("pearson", () => {
  it("is 1 for a straight line and -1 for the reverse, and null for too few or flat values", () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(pearson([1, 1, 1, 1, 1], [1, 2, 3, 4, 5])).toBeNull();
  });
});

describe("summarizeArea", () => {
  it("adds up the range, finds the peak and the share of each month", () => {
    const s = summarizeArea(series(1), "2001-01", "2012-12");
    expect(s.rows).toHaveLength(144);
    expect(s.peak.month.slice(5)).toBe("07");
    expect(s.seasonShare.reduce((a, v) => a + v, 0)).toBeCloseTo(100, 6);
    expect(s.seasonShare[6]).toBeCloseTo(40, 6); // July is 40 of 100 in the profile
    expect(s.estimatedMonths).toBe(0);
  });
  it("returns null when no month is in range", () => {
    expect(summarizeArea(series(1), "2030-01", "2030-12")).toBeNull();
  });
});

describe("two areas", () => {
  const a = summarizeArea(series(1), "2001-01", "2012-12");
  it("an area burning in step with a scaled copy of itself has correlation 1 and the same seasonal shape", () => {
    const b = summarizeArea(series(5), "2001-01", "2012-12");
    expect(sameYears(a, b).correlation).toBeCloseTo(1, 8);
    expect(b.seasonShare[6]).toBeCloseTo(a.seasonShare[6], 8);
    expect(anomalyPairs(a, b).length).toBeGreaterThan(5);
    expect(anomalyPairs(a, b)[0].a).toBeCloseTo(anomalyPairs(a, b)[0].b, 8);
  });
  it("an area whose busy years are shifted does not correlate perfectly", () => {
    const b = summarizeArea(series(1, 1), "2001-01", "2012-12");
    expect(sameYears(a, b).correlation).toBeLessThan(0.99);
  });
});

describe("correlationText", () => {
  it("says it in words, states the number, and never claims a cause", () => {
    expect(correlationText(0.85, 20, false)).toContain("0.85");
    expect(correlationText(0.85, 20, false)).toContain("tend to burn in the same years");
    expect(correlationText(0.1, 20, false)).toContain("largely independent");
    expect(correlationText(0.5, 20, true)).toContain("same MODIS model");
    expect(correlationText(null, 3, false)).toContain("cannot be compared");
  });
});
