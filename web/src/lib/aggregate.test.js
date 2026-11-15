import { describe, expect, it } from "vitest";
import { aggregateSeries, cellWeight, gridCellsCovered } from "./aggregate.js";

// Cell A covers lon 20.0-20.25, lat 10.0-10.25. B is its east neighbour. C is far to the north.
const cellsData = {
  months: ["2011-12", "2012-01", "2012-02", "2012-03"], // first two estimated, then native; last one provisional
  firstViirsIndex: 2,
  provisionalFrom: 3,
  cellSize: 0.25,
  loMult: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1, 1, 1, 1, 1, 0.4],
  hiMult: [2, 1.8, 1.6, 1.4, 1.2, 1, 1, 1, 1, 1, 1, 3],
  cells: [
    { lat: 10.125, lon: 20.125, v: [10, 20, 30, 40] }, // A
    { lat: 10.125, lon: 20.375, v: [100, 200, 300, 400] }, // B
    { lat: 10.875, lon: 20.125, v: [7, 7, 7, 7] }, // C
  ],
};
const bbox = (west, south, east, north) => ({ type: "bbox", west, south, east, north });
const counts = (series) => series.map((r) => r.count);
const A = [10, 20, 30, 40];
const B = [100, 200, 300, 400];

describe("cellWeight", () => {
  const cell = { lat: 10.125, lon: 20.125 };
  it("is the overlapping area fraction for rectangles", () => {
    expect(cellWeight(cell, bbox(20.0, 10.0, 20.125, 10.125))).toBeCloseTo(0.25, 12);
    expect(cellWeight(cell, bbox(20.0, 10.0, 20.25, 10.25))).toBe(1);
    expect(cellWeight(cell, bbox(19, 9, 21, 11))).toBe(1); // AOI larger than the cell
  });
  it("is 0 for a rectangle that only touches or misses the cell", () => {
    expect(cellWeight(cell, bbox(20.25, 10.0, 20.5, 10.25))).toBe(0);
    expect(cellWeight(cell, bbox(30, 30, 31, 31))).toBe(0);
  });
  it("is 1 or 0 by cell centre for polygons", () => {
    const corner = { type: "polygon", coordinates: [[20.0, 10.0], [20.05, 10.0], [20.0, 10.05]] };
    expect(cellWeight(cell, corner)).toBe(0); // overlaps the cell's corner but not its centre
    const square = { type: "polygon", coordinates: [[20.1, 10.1], [20.15, 10.1], [20.15, 10.15], [20.1, 10.15]] };
    expect(cellWeight(cell, square)).toBe(1); // contains the centre although it covers little of the cell
  });
});

describe("aggregateSeries", () => {
  it("AOI inside one cell returns the cell value times the area fraction", () => {
    const s = aggregateSeries(cellsData, bbox(20.0, 10.0, 20.125, 10.125)); // a quarter of A
    s.forEach((r, i) => expect(r.count).toBeCloseTo(A[i] * 0.25, 9));
  });

  it("AOI covering two cells at half each sums correctly", () => {
    const s = aggregateSeries(cellsData, bbox(20.125, 10.0, 20.375, 10.25)); // east half of A + west half of B
    s.forEach((r, i) => expect(r.count).toBeCloseTo(0.5 * A[i] + 0.5 * B[i], 9));
  });

  it("a full-cell AOI is unchanged", () => {
    expect(counts(aggregateSeries(cellsData, bbox(20.0, 10.0, 20.25, 10.25)))).toEqual(A);
  });

  it("polygon selection takes whole cells whose centre is inside", () => {
    const polyAB = { type: "polygon", coordinates: [[20.05, 10.05], [20.45, 10.05], [20.45, 10.2], [20.05, 10.2]] };
    counts(aggregateSeries(cellsData, polyAB)).forEach((c, i) => expect(c).toBe(A[i] + B[i]));
    const polyA = { type: "polygon", coordinates: [[20.05, 10.05], [20.2, 10.05], [20.2, 10.2], [20.05, 10.2]] };
    expect(counts(aggregateSeries(cellsData, polyA))).toEqual(A);
  });

  it("cells outside the AOI are excluded", () => {
    expect(counts(aggregateSeries(cellsData, bbox(20.0, 10.75, 20.25, 11.0)))).toEqual([7, 7, 7, 7]); // only C
    const onlyAB = aggregateSeries(cellsData, bbox(20.0, 10.0, 20.5, 10.25));
    onlyAB.forEach((r, i) => expect(r.count).toBe(A[i] + B[i])); // C not included
  });

  it("an AOI with no cells returns zeros for every month, not an empty array", () => {
    const s = aggregateSeries(cellsData, bbox(50, 50, 51, 51));
    expect(s).toHaveLength(4);
    s.forEach((r) => expect([r.count, r.lo, r.hi]).toEqual([0, 0, 0]));
  });

  it("interval equals count for native months and uses the calendar-month multipliers for estimated ones", () => {
    const s = aggregateSeries(cellsData, bbox(20.0, 10.0, 20.25, 10.25));
    expect([s[2].lo, s[2].hi]).toEqual([s[2].count, s[2].count]);
    expect([s[3].lo, s[3].hi]).toEqual([s[3].count, s[3].count]);
    expect(s[0].lo).toBeCloseTo(10 * 0.4, 9); // 2011-12 -> December multipliers
    expect(s[0].hi).toBeCloseTo(10 * 3, 9);
    expect(s[1].lo).toBeCloseTo(20 * 0.5, 9); // 2012-01 -> January multipliers
    expect(s[1].hi).toBeCloseTo(20 * 2, 9);
  });

  it("flags source and provisional months", () => {
    const s = aggregateSeries(cellsData, bbox(20.0, 10.0, 20.25, 10.25));
    expect(s.map((r) => r.source)).toEqual(["modis_estimated", "modis_estimated", "viirs_native", "viirs_native"]);
    expect(s.map((r) => r.provisional)).toEqual([false, false, false, true]);
    expect(s.map((r) => r.month)).toEqual(cellsData.months);
  });
});

describe("gridCellsCovered", () => {
  it("counts grid cells the rectangle touches, not cells with detections", () => {
    expect(gridCellsCovered(bbox(20.0, 10.0, 20.125, 10.125))).toBe(1);
    expect(gridCellsCovered(bbox(20.0, 10.0, 20.25, 10.25))).toBe(1);
    expect(gridCellsCovered(bbox(20.1, 10.1, 20.3, 10.3))).toBe(4); // straddles a corner of four cells
    expect(gridCellsCovered(bbox(20.0, 10.0, 21.0, 11.0))).toBe(16);
  });
  it("counts grid cells whose centre is inside for polygons", () => {
    const poly = { type: "polygon", coordinates: [[20.05, 10.05], [20.45, 10.05], [20.45, 10.2], [20.05, 10.2]] };
    expect(gridCellsCovered(poly)).toBe(2);
  });
});
