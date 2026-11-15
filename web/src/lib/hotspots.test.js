import { describe, expect, it } from "vitest";
import { cellsAt, hotspotColor, monthIndices, monthSource, peakMonthIndex, rampMax } from "./hotspots.js";

const data = {
  months: ["2011-12", "2012-01", "2012-02", "2012-03", "2012-04"],
  firstViirsIndex: 2,
  provisionalFrom: 4,
  cells: [
    { lat: 1, lon: 1, v: [0, 5, 0, 9, 1] },
    { lat: 2, lon: 2, v: [2, 0, 0, 30, 0] },
    { lat: 3, lon: 3, v: [0, 0, 0, 0, 0] },
  ],
};

describe("monthIndices", () => {
  it("returns the months inside the range, inclusive", () => {
    expect(monthIndices(data, "2012-01", "2012-03")).toEqual([1, 2, 3]);
    expect(monthIndices(data, "2013-01", "2013-12")).toEqual([]);
  });
});

describe("peakMonthIndex", () => {
  it("is the month with the most detections in the range", () => {
    expect(peakMonthIndex(data, "2011-12", "2012-04")).toBe(3); // 9 + 30
    expect(peakMonthIndex(data, "2011-12", "2012-02")).toBe(1); // 5 in January beats 2 in December
  });
  it("is null when the range has no detections or no months", () => {
    expect(peakMonthIndex(data, "2012-02", "2012-02")).toBeNull();
    expect(peakMonthIndex(data, "2020-01", "2020-12")).toBeNull();
  });
});

describe("cellsAt", () => {
  it("keeps only the cells with detections that month", () => {
    expect(cellsAt(data, 3).map((c) => c.lat)).toEqual([1, 2]);
    expect(cellsAt(data, 2)).toEqual([]);
  });
});

describe("monthSource", () => {
  it("labels estimated, native and provisional months the same way the calendar does", () => {
    expect(monthSource(data, 0)).toBe("modis_estimated");
    expect(monthSource(data, 2)).toBe("viirs_native");
    expect(monthSource(data, 4)).toBe("provisional");
  });
});

describe("rampMax and hotspotColor", () => {
  it("rampMax is a high percentile of the non-zero values, and 1 when there are none", () => {
    expect(rampMax([{ v: [0, 0, 0] }])).toBe(1);
    const cells = Array.from({ length: 200 }, (_, i) => ({ v: [i + 1, 0, 0] }));
    expect(rampMax(cells)).toBeGreaterThanOrEqual(198);
  });
  it("colour is brighter for bigger counts and clamps above the maximum", () => {
    // d3 returns "rgb(r, g, b)" or "#rrggbb" depending on the version; read either
    const lum = (css) => (css.startsWith("#")
      ? [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16))
      : css.match(/\d+/g).slice(0, 3).map(Number)).reduce((x, y) => x + y, 0);
    expect(lum(hotspotColor(1, 100))).toBeLessThan(lum(hotspotColor(50, 100)));
    expect(lum(hotspotColor(50, 100))).toBeLessThan(lum(hotspotColor(100, 100)));
    expect(hotspotColor(500, 100)).toBe(hotspotColor(100, 100));
    expect(hotspotColor(-5, 100)).toBe(hotspotColor(0, 100));
  });
});
