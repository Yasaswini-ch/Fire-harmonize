import { describe, expect, it } from "vitest";
import { buildNotes, pitchFor } from "./sonify.js";

const row = (month, count, extra = {}) => ({ month, count, lo: count, hi: count, source: "viirs_native", provisional: false, ...extra });

describe("pitchFor", () => {
  it("is silent for zero or missing counts", () => {
    expect(pitchFor(0, 100)).toBeNull();
    expect(pitchFor(5, 0)).toBeNull();
  });
  it("rises with the count and tops out at the maximum", () => {
    const f = [1, 10, 50, 100, 500].map((c) => pitchFor(c, 100));
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThanOrEqual(f[i - 1]);
    expect(f[4]).toBe(f[3]); // above the max is clamped
  });
});

describe("buildNotes", () => {
  it("returns nothing for no rows", () => {
    expect(buildNotes([])).toEqual({ notes: [], seconds: 0 });
  });
  it("skips months with no detections but keeps their time slot", () => {
    const { notes } = buildNotes([row("2020-01", 0), row("2020-02", 40), row("2020-03", 90)], { msPerMonth: 100 });
    expect(notes.map((n) => n.month)).toEqual(["2020-02", "2020-03"]);
    expect(notes[0].t).toBeCloseTo(0.1);
  });
  it("plays an estimated month as a two-note chord spanning its range, VIIRS months as one sine", () => {
    const { notes } = buildNotes([
      row("2010-06", 100, { source: "modis_estimated", lo: 10, hi: 100 }),
      row("2020-06", 100),
    ]);
    expect(notes[0].wave).toBe("triangle");
    expect(notes[0].freqs).toHaveLength(2);
    expect(notes[0].freqs[0]).toBeLessThan(notes[0].freqs[1]);
    expect(notes[1].wave).toBe("sine");
    expect(notes[1].freqs).toHaveLength(1);
  });
  it("makes provisional months shorter", () => {
    const { notes } = buildNotes([row("2026-10", 50), row("2026-11", 50, { provisional: true })]);
    expect(notes[1].dur).toBeLessThan(notes[0].dur);
  });
  it("never lasts longer than maxSeconds", () => {
    const rows = Array.from({ length: 600 }, (_, i) => row(`2000-${i}`, 10 + (i % 7)));
    expect(buildNotes(rows, { msPerMonth: 110, maxSeconds: 30 }).seconds).toBeLessThanOrEqual(30.0001);
  });
});
