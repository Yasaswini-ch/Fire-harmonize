import { describe, expect, it } from "vitest";
import { aggregateSeries } from "./aggregate.js";
import { loadRegions } from "./data.js";

const m12 = (v) => Array(12).fill(v);
const base = {
  months: ["2011-06", "2012-06"], // the first is a MODIS estimate, the second VIIRS native
  firstViirsIndex: 1,
  provisionalFrom: 2,
  cellSize: 0.25,
  bbox: [0, 0, 10, 8],
  loMult: m12(0.8),
  hiMult: m12(1.25),
  cells: [{ lat: 1.125, lon: 1.125, v: [100, 200] }],
};
const sizeClasses = [
  { id: "1-2", minDeg: 1, maxDeg: 2, lo_mult: m12(0.4), hi_mult: m12(2) },
  { id: "2-3", minDeg: 2, maxDeg: 3, lo_mult: m12(0.5), hi_mult: m12(1.8) },
  { id: "3-5", minDeg: 3, maxDeg: 5, lo_mult: m12(0.7), hi_mult: m12(1.4) },
  { id: "region", minDeg: 10, maxDeg: 10, lo_mult: m12(0.9), hi_mult: m12(1.1) },
];
const box = (w, s, e, n) => ({ type: "bbox", west: w, south: s, east: e, north: n });
const est = (data, aoi) => aggregateSeries(data, aoi)[0];

describe("aggregateSeries interval width by area size", () => {
  const data = { ...base, sizeClasses };
  it("uses a wider interval for a small area than for a bigger one", () => {
    const small = est(data, box(0, 0, 1.5, 1.5)); // longer side 1.5: class 1-2
    const mid = est(data, box(0, 0, 4, 4)); // class 3-5
    expect(small.lo).toBeCloseTo(100 * 0.4, 9);
    expect(small.hi).toBeCloseTo(100 * 2, 9);
    expect(mid.lo).toBeCloseTo(100 * 0.7, 9);
    expect(mid.hi).toBeCloseTo(100 * 1.4, 9);
    expect(small.hi - small.lo).toBeGreaterThan(mid.hi - mid.lo);
  });
  it("uses the region class for an area covering the whole region", () => {
    const whole = est(data, box(0, 0, 10, 8));
    expect(whole.lo).toBeCloseTo(100 * 0.9, 9);
    expect(whole.hi).toBeCloseTo(100 * 1.1, 9);
  });
  it("falls back to the region-wide multipliers when the export has no size classes", () => {
    const r = est({ ...base, sizeClasses: null }, box(0, 0, 1.5, 1.5));
    expect(r.lo).toBeCloseTo(100 * 0.8, 9);
    expect(r.hi).toBeCloseTo(100 * 1.25, 9);
  });
  it("leaves VIIRS-native months exact whatever the size class", () => {
    const native = aggregateSeries(data, box(0, 0, 1.5, 1.5))[1];
    expect(native.lo).toBe(native.hi);
    expect(native.count).toBe(200);
  });
});

describe("loadRegions size class check", () => {
  const region = (extra) => ({ id: "r1", name: "R1", bbox: [0, 0, 1, 1], cellSize: 0.25, lo_mult: m12(1), hi_mult: m12(1), ...extra });
  const stub = (regions) => {
    globalThis.fetch = async () => ({ ok: true, status: 200, statusText: "OK", json: async () => regions });
  };
  it("accepts regions with valid size classes and regions without any", async () => {
    stub([region({ sizeClasses }), region({ id: "r2" })]);
    expect(await loadRegions()).toHaveLength(2);
  });
  it("rejects a size class without twelve multipliers, naming the file and region", async () => {
    stub([region({ sizeClasses: [{ id: "1-2", minDeg: 1, maxDeg: 2, lo_mult: [1], hi_mult: m12(1) }] })]);
    await expect(loadRegions()).rejects.toThrow(/regions\.json: region r1 has a size class \(1-2\)/);
  });
});
