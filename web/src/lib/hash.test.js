import { describe, expect, it } from "vitest";
import { formatHash, parseAoi, stateFromHash } from "./hash.js";

const regions = [
  { id: "western_na", name: "Western North America", bbox: [-126, 32, -112, 52], firstMonth: "2002-01", lastMonth: "2025-12" },
  { id: "zambia", name: "Zambia", bbox: [22, -18, 34, -8], firstMonth: "2002-01", lastMonth: "2025-12" },
];
const bbox = (west, south, east, north) => ({ type: "bbox", west, south, east, north });

describe("formatHash / stateFromHash", () => {
  it("round-trips a bbox state", () => {
    const state = { regionId: "zambia", aoi: bbox(22, -18, 34, -8), start: "2015-01", end: "2025-12" };
    expect(formatHash(state)).toBe("#region=zambia&aoi=bbox:22,-18,34,-8&from=2015-01&to=2025-12");
    expect(stateFromHash(formatHash(state), regions)).toEqual(state);
  });
  it("round-trips a polygon state", () => {
    const state = { regionId: "zambia", aoi: { type: "polygon", coordinates: [[23, -17], [30.5, -17], [30, -10]] }, start: "2010-03", end: "2012-06" };
    expect(formatHash(state)).toContain("aoi=poly:23,-17;30.5,-17;30,-10");
    expect(stateFromHash(formatHash(state), regions)).toEqual(state);
  });
  it("returns null when nothing usable is in the hash", () => {
    expect(stateFromHash("", regions)).toBeNull();
    expect(stateFromHash("#", regions)).toBeNull();
    expect(stateFromHash("#foo=bar&region=atlantis", regions)).toBeNull();
    expect(stateFromHash("#aoi=bbox:1,2,3", regions)).toBeNull();
  });
  it("ignores invalid parts and keeps the valid ones", () => {
    // bad aoi (west >= east): region preset instead; bad month: region default
    const s = stateFromHash("#region=zambia&aoi=bbox:34,-18,22,-8&from=2015-13&to=abc", regions);
    expect(s).toEqual({ regionId: "zambia", aoi: bbox(22, -18, 34, -8), start: "2002-01", end: "2025-12" });
    // unknown region but good aoi: the region is found from the aoi
    const t = stateFromHash("#region=atlantis&aoi=bbox:25,-15,30,-10&from=2020-01&to=2020-12", regions);
    expect(t).toEqual({ regionId: "zambia", aoi: bbox(25, -15, 30, -10), start: "2020-01", end: "2020-12" });
  });
  it("uses the region the AOI actually overlaps when the hash disagrees", () => {
    expect(stateFromHash("#region=western_na&aoi=bbox:25,-15,30,-10", regions).regionId).toBe("zambia");
  });
  it("keeps an AOI outside every region (the app shows its no-coverage message)", () => {
    const s = stateFromHash("#aoi=bbox:70,10,80,20", regions);
    expect(s.aoi).toEqual(bbox(70, 10, 80, 20));
    expect(s.regionId).toBe("western_na");
  });
  it("drops a range that does not overlap the region's data", () => {
    expect(stateFromHash("#region=zambia&from=1990-01&to=1991-12", regions)).toMatchObject({ start: "2002-01", end: "2025-12" });
    expect(stateFromHash("#region=zambia&from=2020-06&to=2019-01", regions)).toMatchObject({ start: "2002-01", end: "2025-12" });
  });
  it("survives malformed escapes and injected text", () => {
    // the broken region key is ignored, the valid aoi is kept
    expect(stateFromHash("#region=%E0%A4%A&aoi=bbox:1,2,3,4", regions)).toMatchObject({ aoi: bbox(1, 2, 3, 4) });
    expect(stateFromHash("#region=<script>alert(1)</script>", regions)).toBeNull();
    expect(stateFromHash("#aoi=%E0%A4%A", regions)).toBeNull();
  });
});

describe("parseAoi", () => {
  it("rejects out-of-range, non-numeric, empty and degenerate values", () => {
    expect(parseAoi("bbox:22,-18,34,-8")).toEqual(bbox(22, -18, 34, -8));
    expect(parseAoi("bbox:22,-91,34,-8")).toBeNull();
    expect(parseAoi("bbox:-181,0,34,8")).toBeNull();
    expect(parseAoi("bbox:22,-18,22,-8")).toBeNull();
    expect(parseAoi("bbox:22,-18,34,-18")).toBeNull();
    expect(parseAoi("bbox:a,b,c,d")).toBeNull();
    expect(parseAoi("bbox:,,,")).toBeNull();
    expect(parseAoi("bbox:1,2,3,Infinity")).toBeNull();
    expect(parseAoi("poly:1,1;2,2")).toBeNull(); // fewer than 3 vertices
    expect(parseAoi("poly:1,1;2,2;3")).toBeNull();
    expect(parseAoi("poly:1,1;2,2;3,95")).toBeNull();
    expect(parseAoi("circle:1,2,3")).toBeNull();
    expect(parseAoi(undefined)).toBeNull();
  });
  it("caps the number of polygon vertices", () => {
    const many = Array.from({ length: 501 }, (_, i) => `${i % 100},${i % 80}`).join(";");
    expect(parseAoi(`poly:${many}`)).toBeNull();
  });
});
