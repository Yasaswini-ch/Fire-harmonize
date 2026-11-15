import { describe, expect, it } from "vitest";
import { falseJumpOf, jumpText, yearRatio } from "./falseJump.js";

const months = [];
for (let y = 2010; y <= 2014; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
const FV = months.indexOf("2012-02");
// raw: MODIS counts of 10 a month before VIIRS, 50 a month from then on. harmonized: 100 throughout.
const series = (over = {}) => ({
  months, firstViirsIndex: FV,
  raw: months.map((_, i) => (i < FV ? 10 : 50)),
  harmonized: months.map(() => 100),
  lo: months.map((_, i) => (i < FV ? 80 : 100)),
  hi: months.map((_, i) => (i < FV ? 130 : 100)),
  ...over,
});
const meta = (s = series()) => ({ regions: { zambia: { rawVsHarmonized: s } } });

describe("yearRatio", () => {
  it("is the 12 months from the start over the 12 months before it", () => {
    expect(yearRatio(series().raw, FV)).toBe(5);
    expect(yearRatio(series().harmonized, FV)).toBe(1);
  });
  it("is null when a window is missing or the earlier year is empty", () => {
    expect(yearRatio(series().raw, 5)).toBeNull();
    expect(yearRatio(series().raw, months.length - 3)).toBeNull();
    expect(yearRatio(new Array(40).fill(0), 20)).toBeNull();
  });
});

describe("falseJumpOf", () => {
  const j = falseJumpOf(meta(), "zambia");
  it("keeps one point per month and marks the estimated months", () => {
    expect(j.points).toHaveLength(months.length);
    expect(j.points[FV - 1]).toMatchObject({ month: "2012-01", raw: 10, harmonized: 100, estimated: true });
    expect(j.points[FV]).toMatchObject({ month: "2012-02", raw: 50, estimated: false });
  });
  it("reports the jump in the raw and harmonized records and the windows compared", () => {
    expect(j.rawRatio).toBe(5);
    expect(j.harmonizedRatio).toBe(1);
    expect(j.firstViirsMonth).toBe("2012-02");
    expect([j.beforeFrom, j.afterTo]).toEqual(["2011-02", "2013-01"]);
  });
  it("returns null for an older export, a bad index or a series of the wrong length", () => {
    expect(falseJumpOf({ regions: { zambia: {} } }, "zambia")).toBeNull();
    expect(falseJumpOf(meta(), "western_na")).toBeNull();
    expect(falseJumpOf(meta(series({ firstViirsIndex: 0 })), "zambia")).toBeNull();
    expect(falseJumpOf(meta(series({ raw: [1, 2, 3] })), "zambia")).toBeNull();
    expect(falseJumpOf(meta(series({ hi: months.map(() => null) })), "zambia")).toBeNull();
    expect(falseJumpOf(null, "zambia")).toBeNull();
  });
});

describe("jumpText", () => {
  it("states both ratios and the start month, with numbers from the series", () => {
    const out = jumpText(falseJumpOf(meta(), "zambia"), "Zambia");
    expect(out).toContain("In the raw record for Zambia");
    expect(out).toContain("from February 2012");
    expect(out).toContain("5.0 times");
    expect(out).toContain("gives 1.0 times");
    expect(out).toContain("uncertainty of the estimated months");
  });
  it("rounds large ratios to whole numbers", () => {
    const s = series({ raw: months.map((_, i) => (i < FV ? 1 : 20)) });
    expect(jumpText(falseJumpOf(meta(s), "zambia"), "Zambia")).toContain("20 times");
  });
  it("says nothing when the comparison cannot be made", () => {
    expect(jumpText(null, "Zambia")).toBeNull();
    const short = series({ months: months.slice(0, 20), raw: months.slice(0, 20).map(() => 1), harmonized: months.slice(0, 20).map(() => 1), lo: months.slice(0, 20).map(() => 1), hi: months.slice(0, 20).map(() => 1), firstViirsIndex: 14 });
    expect(jumpText(falseJumpOf(meta(short), "zambia"), "Zambia")).toBeNull();
  });
});
