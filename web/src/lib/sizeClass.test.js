import { describe, expect, it } from "vitest";
import { longerSideDeg, sizeClassFor, smallAreaNotice } from "./sizeClass.js";

const m12 = (v) => Array(12).fill(v);
const region = {
  bbox: [0, 0, 10, 8],
  sizeClasses: [
    { id: "3-5", minDeg: 3, maxDeg: 5, lo_mult: m12(0.7), hi_mult: m12(1.3) },
    { id: "1-2", minDeg: 1, maxDeg: 2, lo_mult: m12(0.3), hi_mult: m12(2.5) },
    { id: "2-3", minDeg: 2, maxDeg: 3, lo_mult: m12(0.5), hi_mult: m12(1.8) },
    { id: "region", minDeg: 10, maxDeg: 10, lo_mult: m12(0.9), hi_mult: m12(1.1) },
  ],
};
const box = (w, s, e, n) => ({ type: "bbox", west: w, south: s, east: e, north: n });
const meta = {
  regions: {
    r: {
      sizeClasses: [
        { id: "1-2", label: "1 to 2 degrees", minDeg: 1, maxDeg: 2, medianApePct: 47.4, biasPct: 3 },
        { id: "region", minDeg: 10, maxDeg: 10, medianApePct: 14.2 },
      ],
    },
  },
};

describe("longerSideDeg", () => {
  it("is the longer side of a rectangle", () => {
    expect(longerSideDeg(box(0, 0, 1.5, 4))).toBe(4);
    expect(longerSideDeg(box(0, 0, 6, 2))).toBe(6);
  });
  it("uses the bounds of a polygon", () => {
    expect(longerSideDeg({ type: "polygon", coordinates: [[0, 0], [3, 0.5], [1, 2.5]] })).toBe(3);
  });
});

describe("sizeClassFor", () => {
  it("picks the class by the longer side, whatever order the classes are listed in", () => {
    expect(sizeClassFor(box(0, 0, 1.2, 0.5), region).id).toBe("1-2");
    expect(sizeClassFor(box(0, 0, 0.5, 2.4), region).id).toBe("2-3");
    expect(sizeClassFor(box(0, 0, 4.9, 1), region).id).toBe("3-5");
  });
  it("puts a boundary value in the larger class", () => {
    expect(sizeClassFor(box(0, 0, 2, 1), region).id).toBe("2-3");
    expect(sizeClassFor(box(0, 0, 3, 1), region).id).toBe("3-5");
  });
  it("uses the smallest class for areas smaller than anything measured", () => {
    expect(sizeClassFor(box(0, 0, 0.25, 0.25), region).id).toBe("1-2");
  });
  it("uses the largest measured class for a big area that is not the whole region", () => {
    expect(sizeClassFor(box(0, 0, 9, 6), region).id).toBe("3-5");
  });
  it("uses the region class when the area covers the whole region, even if drawn larger", () => {
    expect(sizeClassFor(box(0, 0, 10, 8), region).id).toBe("region");
    expect(sizeClassFor(box(-2, -2, 12, 12), region).id).toBe("region");
    expect(sizeClassFor(box(0, 0, 10, 7.9), region).id).toBe("3-5");
  });
  it("returns null when the export has no size classes", () => {
    expect(sizeClassFor(box(0, 0, 1, 1), { bbox: [0, 0, 10, 8] })).toBeNull();
    expect(sizeClassFor(box(0, 0, 1, 1), { sizeClasses: [] })).toBeNull();
    expect(sizeClassFor(box(0, 0, 1, 1), null)).toBeNull();
  });
});

describe("smallAreaNotice", () => {
  const args = { meta, regionId: "r", region, estimatedRange: ["2002-08", "2012-01"] };
  it("is shown for a longer side under 2 degrees, with the error read from meta.json", () => {
    const n = smallAreaNotice({ ...args, aoi: box(0, 0, 1.5, 1.2) });
    expect(n.text).toBe("Estimates for August 2002 to January 2012 are less certain for small areas. See the uncertainty range.");
    expect(n.measured).toBe("Measured typical error for areas of 1 to 2 degrees: 47% (median).");
    expect(n.unmeasured).toBeNull();
  });
  it("is not shown at 2 degrees or more", () => {
    expect(smallAreaNotice({ ...args, aoi: box(0, 0, 2, 1) })).toBeNull();
    expect(smallAreaNotice({ ...args, aoi: box(0, 0, 4, 4) })).toBeNull();
  });
  it("says so when the area is smaller than any size that was measured", () => {
    const n = smallAreaNotice({ ...args, aoi: box(0, 0, 0.4, 0.3) });
    expect(n.unmeasured).toContain("smaller than 1 degrees were not measured");
  });
  it("shows no number when meta.json does not have the error", () => {
    const n = smallAreaNotice({ ...args, meta: { regions: {} }, aoi: box(0, 0, 1.5, 1.2) });
    expect(n.measured).toBe("Measured typical error for this size: not in meta.json.");
    expect(n.measured).not.toMatch(/\d+%/);
  });
  it("does not invent the period when the estimated range is unknown", () => {
    const n = smallAreaNotice({ ...args, estimatedRange: null, aoi: box(0, 0, 1.5, 1.2) });
    expect(n.text).toBe("Estimates for the early years are less certain for small areas. See the uncertainty range.");
  });
});
