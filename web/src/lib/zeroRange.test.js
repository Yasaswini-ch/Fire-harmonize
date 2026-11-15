import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MethodsPanel from "../components/MethodsPanel.jsx";
import { aggregateSeries } from "./aggregate.js";
import { FEW_SAMPLE_AREAS, smallAreaNotice } from "./sizeClass.js";

const m12 = (v) => Array(12).fill(v);
const box = (w, s, e, n) => ({ type: "bbox", west: w, south: s, east: e, north: n });

describe("a month the model estimates as 0 detections", () => {
  const data = {
    months: ["2011-06", "2011-07", "2012-06"],
    firstViirsIndex: 2,
    provisionalFrom: 3,
    cellSize: 0.25,
    bbox: [0, 0, 10, 8],
    loMult: m12(0.8),
    hiMult: m12(1.25),
    sizeClasses: [
      { id: "1-2", minDeg: 1, maxDeg: 2, lo_mult: m12(0.4), hi_mult: m12(2), zeroPredHi: 9 },
      { id: "3-5", minDeg: 3, maxDeg: 5, lo_mult: m12(0.7), hi_mult: m12(1.4), zeroPredHi: 18 },
      { id: "region", minDeg: 10, maxDeg: 10, lo_mult: m12(0.9), hi_mult: m12(1.1), zeroPredHi: 0 },
    ],
    cells: [{ lat: 1.125, lon: 1.125, v: [100, 0, 0] }],
  };
  it("gets a range from 0 up to the level seen in such months, not 0 to 0", () => {
    const zero = aggregateSeries(data, box(0, 0, 1.5, 1.5))[1];
    expect(zero.count).toBe(0);
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBe(9);
  });
  it("uses the bound of the area's own size class", () => {
    expect(aggregateSeries(data, box(0, 0, 4, 4))[1].hi).toBe(18);
    expect(aggregateSeries(data, box(0, 0, 10, 8))[1].hi).toBe(0);
  });
  it("leaves months with a positive estimate on the multipliers", () => {
    const pos = aggregateSeries(data, box(0, 0, 1.5, 1.5))[0];
    expect(pos.lo).toBeCloseTo(40, 9);
    expect(pos.hi).toBeCloseTo(200, 9);
  });
  it("does not touch VIIRS-native months, even when they are 0", () => {
    const native = aggregateSeries(data, box(0, 0, 1.5, 1.5))[2];
    expect(native.hi).toBe(0);
  });
  it("is 0 to 0 when the export has no bound (an older export)", () => {
    const old = { ...data, sizeClasses: data.sizeClasses.map((c) => ({ ...c, zeroPredHi: undefined })) };
    expect(aggregateSeries(old, box(0, 0, 1.5, 1.5))[1].hi).toBe(0);
  });
});

describe("small-area notice context", () => {
  const region = { bbox: [0, 0, 10, 8], sizeClasses: [{ id: "1-2", minDeg: 1, maxDeg: 2, lo_mult: m12(1), hi_mult: m12(1) }] };
  const meta = (extra) => ({ regions: { r: { sizeClasses: [{ id: "1-2", minDeg: 1, maxDeg: 2, medianApePct: 100, countWeightedErrorPct: 27.3, medianActualCountNonzero: 15, nAois: 12, ...extra }] } } });
  const args = { regionId: "r", region, aoi: box(0, 0, 1.5, 1.2), estimatedRange: ["2002-08", "2012-01"] };
  it("says how thin the counts are and how the error looks by total detections, from meta.json", () => {
    const n = smallAreaNotice({ ...args, meta: meta() });
    expect(n.thin).toBe("A typical month in areas this size has about 15 detections, so percentages swing widely; counted by total detections the error is 27%.");
  });
  it("warns when only a few sample areas stand behind the figure", () => {
    expect(smallAreaNotice({ ...args, meta: meta() }).fewSamples).toBe("This figure rests on only 12 sample areas.");
    expect(smallAreaNotice({ ...args, meta: meta({ nAois: FEW_SAMPLE_AREAS }) }).fewSamples).toBeNull();
  });
  it("leaves the extra lines out when meta.json does not have the numbers", () => {
    const n = smallAreaNotice({ ...args, meta: meta({ medianActualCountNonzero: undefined, countWeightedErrorPct: undefined, nAois: undefined }) });
    expect(n.thin).toBeNull();
    expect(n.fewSamples).toBeNull();
  });
});

describe("MethodsPanel recent bridge and zero-estimate column", () => {
  const meta = (bridge) => ({
    dataVersion: "V", generated: "G", filters: {}, snpp: {},
    regions: {
      z: {
        model: { name: "m", fitWindow: ["2012-02", "2021-12"] }, cv: { chosen: { aoi: { median_ape_pct: 1, bias_pct: 1 } } },
        bridgeNoaa20ToSnpp: { overlap: ["2018-01", "2026-07"], aoiMedianRatio: 1, regionMonthlyMedianRatio: 1, scalingApplied: false, scaleFactor: 1, ...bridge },
        sizeClasses: [{ id: "1-2", label: "1 to 2 degrees", minDeg: 1, maxDeg: 2, nAois: 12, medianApePct: 20, biasPct: 1, countWeightedErrorPct: 10, medianActualCountNonzero: 700, coverage: { targetPct: 80, heldOutYearsPct: 76.3, zeroPredSharePct: 19.04 } }],
      },
    },
  });
  const html = (m) => renderToStaticMarkup(createElement(MethodsPanel, { meta: m, regionId: "z", regionName: "Z" }));
  it("flags a recent ratio outside the tolerance", () => {
    const out = html(meta({ recentMonths: ["2026-02", "2026-07"], recentRatioMedian: 1.1145, recentOutsideTolerance: true }));
    expect(out).toContain("latest months (2026-02 to 2026-07) the median ratio is 1.115");
    expect(out).toContain("recent Suomi NPP months may be low");
  });
  it("shows a recent ratio inside the tolerance without a warning", () => {
    const out = html(meta({ recentMonths: ["2026-02", "2026-07"], recentRatioMedian: 1.01, recentOutsideTolerance: false }));
    expect(out).toContain("the median ratio is 1.010.");
    expect(out).not.toContain("may be low");
  });
  it("says nothing about recent months when the export has no such field", () => {
    expect(html(meta({}))).not.toContain("latest months");
  });
  it("shows the share of months estimated as 0", () => {
    const out = html(meta({}));
    expect(out).toContain("Months estimated as 0");
    expect(out).toContain("19%");
  });
});
