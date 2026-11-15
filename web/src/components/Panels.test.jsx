import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DownloadPanel from "./DownloadPanel.jsx";
import Footer from "./Footer.jsx";
import MethodExplainer from "./MethodExplainer.jsx";
import MethodsPanel from "./MethodsPanel.jsx";

const meta = {
  dataVersion: "TEST-VERSION", generated: "2000-01-01",
  filters: { modis_min_confidence: 33, viirs_dropped_confidence: ["l"], modis_platforms_kept: ["aqua"], type_kept: 0, static_mask_round_deg: 0.007 },
  platformNote: "PLATFORM-NOTE-TEXT",
  snpp: { note: "SNPP-NOTE-TEXT", lastDateUsedInSeries: "2031-04-05" },
  methodsSummary: "PIPELINE-SUMMARY-TEXT",
  regions: {
    zambia: {
      model: { name: "test model", fitWindow: ["2012-02", "2021-11"], cvFolds: 7 },
      cv: { chosen: { aoi: { median_ape_pct: 12.34, bias_pct: -3.21 } }, interval: "test interval note" },
      warnings: ["TEST-WARNING"],
      bridgeNoaa20ToSnpp: { overlap: ["2018-01", "2018-12"], aoiMedianRatio: 1.0234, regionMonthlyMedianRatio: 0.9876, scalingApplied: false, scaleFactor: 1 },
      driftDiagnostic: { note: "DRIFT-NOTE-TEXT" },
      staticMask: { sp_viirs_rows: 123456, sp_viirs_type_nonzero_rows: 789 },
    },
  },
};
const html = (props) => renderToStaticMarkup(createElement(MethodsPanel, { meta, regionId: "zambia", regionName: "Zambia", ...props }));

describe("MethodsPanel", () => {
  it("is closed by default (a details element without the open attribute)", () => {
    const out = html({});
    expect(out).toContain("<details");
    expect(out).not.toMatch(/<details[^>]*\sopen/);
  });
  it("shows validation numbers read from meta.json", () => {
    const out = html({});
    for (const s of ["test model", "2012-02 to 2021-11", ">7<", "12.3%", "-3.2%", "TEST-WARNING", "test interval note", "confidence 33", "low confidence", "aqua", "PLATFORM-NOTE-TEXT", "SNPP-NOTE-TEXT", "1.023", "PIPELINE-SUMMARY-TEXT"]) {
      expect(out).toContain(s);
    }
  });
  it("lists every required limitation", () => {
    const out = html({});
    for (const s of ["assumed to hold for earlier years", "not area burned", "not unique fires", "VIIRS-equivalent", "Confidence filtering", "provisional", "MODIS series uses"]) {
      expect(out).toContain(s);
    }
  });
  it("states the Suomi NPP stop, the NOAA-20 bridge ratio and whether scaling was applied, from meta.json", () => {
    const out = html({});
    for (const s of ["SNPP-NOTE-TEXT", "through 2031-04-05", "later months come from NOAA-20", "over 2018-01 to 2018-12", "median ratio 1.023", "regional monthly median 0.988", "scaling not applied"]) {
      expect(out).toContain(s);
    }
    const scaled = html({ meta: { ...meta, regions: { zambia: { ...meta.regions.zambia, bridgeNoaa20ToSnpp: { ...meta.regions.zambia.bridgeNoaa20ToSnpp, scalingApplied: true, scaleFactor: 1.25 } } } } });
    expect(scaled).toContain("scaling applied (factor 1.250)");
  });
  it("states the Aqua drift, the estimated period and the fit window", () => {
    const out = html({ estimatedRange: ["2002-01", "2012-01"] });
    expect(out).toContain("Aqua&#x27;s crossing time has drifted");
    expect(out).toContain("months from 2002-01 to 2012-01");
    expect(out).toContain("fitted on 2012-02 to 2021-11");
    expect(out).toContain("DRIFT-NOTE-TEXT");
  });
  it("states the near-real-time location mask with its numbers from meta.json", () => {
    const out = html({});
    expect(out).toContain("no type field");
    expect(out).toContain("location mask");
    expect(out).toContain("789 standard-processing VIIRS detections");
    expect(out).toContain("out of 123456");
    expect(out).toContain("0.007 degrees");
  });
  it("shows 'not in meta.json' for the new items when their fields are missing, with no invented numbers", () => {
    const out = html({ meta: { regions: { zambia: { model: {}, cv: {} } } } });
    expect(out).toContain("Bridge ratio: not in meta.json for this region");
    expect(out).toContain("months from not in meta.json to not in meta.json");
    expect(out).toContain("through not in meta.json");
    expect(out).toContain("from not in meta.json standard-processing");
    expect(out).not.toMatch(/\d{4}-\d{2}/); // no month or date appears
  });
  it("keeps the fixed explanation under 150 words with no digits in it", () => {
    const para = renderToStaticMarkup(createElement(MethodExplainer)).match(/How the numbers are made<\/h2><p>([\s\S]*?)<\/p>/)[1].replace(/&#?\w+;/g, "'"); // HTML entities contain digits
    expect(para.split(/\s+/).filter(Boolean).length).toBeLessThan(150);
    expect(para).not.toMatch(/\d/);
  });
  it("shows 'not in meta.json' instead of inventing a number when a field is missing", () => {
    const out = html({ meta: { regions: { zambia: { model: {}, cv: {} } } } });
    expect(out).toContain("not in meta.json");
    expect(out).not.toMatch(/\d\.\d%/);
    expect(html({ regionId: "nowhere" })).toContain("No entry for nowhere in meta.json");
  });
});

describe("DownloadPanel", () => {
  const cellsData = {
    months: ["2020-01", "2020-02"], firstViirsIndex: 0, provisionalFrom: 2, cellSize: 0.25,
    cells: [{ lat: 10.125, lon: 20.125, v: [1, 2] }],
  };
  const rangeRows = [{ month: "2020-01", count: 1, lo: 1, hi: 1, source: "viirs_native", provisional: false }, { month: "2020-02", count: 2, lo: 2, hi: 2, source: "viirs_native", provisional: false }];
  const props = { region: { id: "zambia", name: "Zambia" }, aoi: { type: "bbox", west: 20, south: 10, east: 20.25, north: 10.25 }, start: "2020-01", end: "2020-02", rangeRows, cellsData };
  it("has both labelled buttons and states the row counts", () => {
    const out = renderToStaticMarkup(createElement(DownloadPanel, props));
    expect(out).toContain("Download harmonized monthly counts (CSV)");
    expect(out).toContain("Download gridded cell counts (CSV)");
    expect(out).toContain("2 rows (1 grid cells");
    expect(out).not.toMatch(/hotspot/i);
  });
  it("disables the cell download and says why when the AOI holds no cells", () => {
    const out = renderToStaticMarkup(createElement(DownloadPanel, { ...props, aoi: { type: "bbox", west: 0, south: 0, east: 1, north: 1 } }));
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Download gridded cell counts/);
    expect(out).toContain("No grid cells with data in this area");
  });
});

describe("Footer", () => {
  it("credits FIRMS with links and carries the model-estimate line", () => {
    const out = renderToStaticMarkup(createElement(Footer));
    expect(out).toContain("Harmonized values are model estimates, not observations.");
    expect(out).toContain("https://www.earthdata.nasa.gov/data/tools/firms");
    expect(out).toContain("https://firms.modaps.eosdis.nasa.gov/api/area/");
  });
});
