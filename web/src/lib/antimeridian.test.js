import { describe, expect, it } from "vitest";
import { fixGeometry, unwrapRing } from "./antimeridian.js";

describe("unwrapRing", () => {
  it("leaves a ring that does not cross the date line alone", () => {
    const ring = [[10, 0], [20, 0], [20, 10], [10, 0]];
    expect(unwrapRing(ring)).toEqual(ring);
  });
  it("makes a ring that crosses +180 continuous", () => {
    const out = unwrapRing([[170, 65], [180, 65], [-170, 66], [-175, 70], [170, 65]]);
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i][0] - out[i - 1][0])).toBeLessThan(180);
    expect(Math.max(...out.map((p) => p[0]))).toBeGreaterThan(180);
  });
  it("closes a ring that wraps the south pole along the pole", () => {
    const out = unwrapRing([[-180, -70], [-90, -72], [0, -75], [90, -72], [180, -70], [-180, -70]]);
    expect(out.some((p) => p[1] === -90)).toBe(true);
  });
});

describe("fixGeometry", () => {
  it("adds a copy on the other side for a polygon that runs past 180", () => {
    const g = { type: "Polygon", coordinates: [[[170, 65], [180, 65], [-170, 66], [-175, 70], [170, 65]]] };
    const fixed = fixGeometry(g);
    expect(fixed.type).toBe("MultiPolygon");
    expect(fixed.coordinates).toHaveLength(2);
    const copyXs = fixed.coordinates[1][0].map((p) => p[0]);
    expect(Math.min(...copyXs)).toBeLessThan(-170); // shifted by -360, so the part past the edge reappears near -180
    expect(Math.max(...copyXs)).toBeLessThanOrEqual(-170 + 1e-9);
  });
  it("keeps an ordinary polygon as one polygon", () => {
    const g = { type: "Polygon", coordinates: [[[10, 0], [20, 0], [20, 10], [10, 0]]] };
    expect(fixGeometry(g).coordinates).toHaveLength(1);
  });
});
