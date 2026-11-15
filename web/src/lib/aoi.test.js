import { describe, expect, it } from "vitest";
import { aoiFromLatLngs, aoiFields, clipAoi, intersectBbox, rangeError, regionsForAoi, validateBboxInput } from "./aoi.js";

const regions = [
  { id: "a", name: "Region A", bbox: [-126, 32, -112, 52] },
  { id: "b", name: "Region B", bbox: [22, -18, 34, -8] },
];
const fields = (o = {}) => ({ minLat: "40", maxLat: "45", minLon: "-120", maxLon: "-115", ...o });

describe("validateBboxInput", () => {
  it("accepts a valid box and returns an AOI in lon/lat order", () => {
    const r = validateBboxInput(fields());
    expect(r.ok).toBe(true);
    expect(r.aoi).toEqual({ type: "bbox", west: -120, south: 40, east: -115, north: 45 });
  });
  it("rejects out-of-range, non-numeric and reversed values with a message per field", () => {
    expect(validateBboxInput(fields({ minLat: "-91" })).errors.minLat).toMatch(/-90 and 90/);
    expect(validateBboxInput(fields({ maxLon: "181" })).errors.maxLon).toMatch(/-180 and 180/);
    expect(validateBboxInput(fields({ minLon: "abc" })).errors.minLon).toBe("Enter a number");
    expect(validateBboxInput(fields({ maxLat: "" })).errors.maxLat).toBe("Enter a number");
    expect(validateBboxInput(fields({ minLat: "45", maxLat: "40" })).errors.maxLat).toBe("North must be greater than south");
    expect(validateBboxInput(fields({ minLon: "-115", maxLon: "-115" })).errors.maxLon).toBe("East must be greater than west");
  });
});

describe("clipping and region matching", () => {
  it("intersectBbox needs shared area, touching edges do not count", () => {
    expect(intersectBbox([0, 0, 2, 2], [1, 1, 3, 3])).toEqual([1, 1, 2, 2]);
    expect(intersectBbox([0, 0, 1, 1], [1, 0, 2, 1])).toBeNull();
  });
  it("a box fully inside a region is not clipped", () => {
    const c = clipAoi({ type: "bbox", west: -120, south: 40, east: -115, north: 45 }, regions[0].bbox);
    expect(c.wasClipped).toBe(false);
  });
  it("a box that extends outside is clipped to the overlap and flagged", () => {
    const c = clipAoi({ type: "bbox", west: -130, south: 30, east: -120, north: 40 }, regions[0].bbox);
    expect(c.wasClipped).toBe(true);
    expect(c.aoi).toEqual({ type: "bbox", west: -126, south: 32, east: -120, north: 40 });
  });
  it("a polygon is clipped to the region and flagged", () => {
    const poly = { type: "polygon", coordinates: [[-130, 40], [-120, 40], [-120, 45], [-130, 45]] };
    const c = clipAoi(poly, regions[0].bbox);
    expect(c.wasClipped).toBe(true);
    const xs = c.aoi.coordinates.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(-126);
    expect(Math.max(...xs)).toBe(-120);
  });
  it("no overlap returns null and no region matches", () => {
    const aoi = { type: "bbox", west: 70, south: 20, east: 80, north: 30 }; // India
    expect(clipAoi(aoi, regions[0].bbox)).toBeNull();
    expect(regionsForAoi(aoi, regions)).toEqual([]);
    expect(clipAoi({ type: "polygon", coordinates: [[70, 20], [80, 20], [75, 30]] }, regions[1].bbox)).toBeNull();
  });
  it("regionsForAoi lists each overlapping region with its clipped AOI", () => {
    const aoi = { type: "bbox", west: 25, south: -15, east: 30, north: -10 };
    const m = regionsForAoi(aoi, regions);
    expect(m.map((x) => x.region.id)).toEqual(["b"]);
    expect(m[0].wasClipped).toBe(false);
  });
});

describe("rangeError", () => {
  const r = { firstMonth: "2002-08", lastMonth: "2026-10" };
  it("accepts a valid range and rejects malformed, reversed and out-of-data ranges", () => {
    expect(rangeError(r, "2010-01", "2020-12")).toBeNull();
    expect(rangeError(r, "2010-1", "2020-12")).toMatch(/YYYY-MM/);
    expect(rangeError(r, "", "2020-12")).toMatch(/YYYY-MM/);
    expect(rangeError(r, "2020-12", "2010-01")).toMatch(/not be after/);
    expect(rangeError(r, "1990-01", "1995-01")).toMatch(/2002-08 to 2026-10/);
  });
});

describe("AOI conversions", () => {
  it("aoiFields gives rounded bounds for the form, also for polygons", () => {
    expect(aoiFields({ type: "bbox", west: -120.123456, south: 40, east: -115, north: 45 })).toEqual(
      { minLat: "40", maxLat: "45", minLon: "-120.1235", maxLon: "-115" });
    expect(aoiFields({ type: "polygon", coordinates: [[1, 2], [3, 2], [2, 5]] })).toEqual(
      { minLat: "2", maxLat: "5", minLon: "1", maxLon: "3" });
  });
  it("aoiFromLatLngs builds bbox and polygon AOIs in lon/lat and clamps wrapped longitudes", () => {
    const rect = [{ lat: 10, lng: 20 }, { lat: 10, lng: 25 }, { lat: 15, lng: 25 }, { lat: 15, lng: 20 }];
    expect(aoiFromLatLngs("rectangle", rect)).toEqual({ type: "bbox", west: 20, south: 10, east: 25, north: 15 });
    expect(aoiFromLatLngs("polygon", rect).coordinates[0]).toEqual([20, 10]);
    expect(aoiFromLatLngs("rectangle", [{ lat: 95, lng: 190 }, { lat: 0, lng: 0 }]))
      .toEqual({ type: "bbox", west: 0, south: 0, east: 180, north: 90 });
  });
});
