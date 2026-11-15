import { describe, expect, it } from "vitest";
import { aoiSummary } from "./aoiSummary.js";

describe("aoiSummary", () => {
  it("gives the size and the readable bounds of a rectangle", () => {
    expect(aoiSummary({ type: "bbox", west: 22, south: -18, east: 34, north: -8 })).toBe("12° × 10° · 22°E to 34°E · 18°S to 8°S");
  });
  it("uses W and S for western and southern coordinates, N and E for the others", () => {
    expect(aoiSummary({ type: "bbox", west: -126, south: 32, east: -112, north: 52 })).toBe("14° × 20° · 126°W to 112°W · 32°N to 52°N");
  });
  it("rounds to two decimals without trailing noise", () => {
    expect(aoiSummary({ type: "bbox", west: 0.1234, south: 0, east: 1.5, north: 1 })).toBe("1.38° × 1° · 0.12°E to 1.5°E · 0°N to 1°N");
  });
  it("describes a polygon by its bounds", () => {
    const s = aoiSummary({ type: "polygon", coordinates: [[0, 0], [3, 0.5], [1, 2.5]] });
    expect(s).toBe("Polygon within 3° × 2.5° · 0°E to 3°E · 0°N to 2.5°N");
  });
});
