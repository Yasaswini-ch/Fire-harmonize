import { describe, expect, it } from "vitest";
import { cellExportPlan, cellsCsv, cellsFileName, csvField, monthlyCsv, monthlyFileName, toCsv } from "./csv.js";

const BOM = "﻿";
const bbox = (west, south, east, north) => ({ type: "bbox", west, south, east, north });
const cellsData = {
  months: ["2011-12", "2012-01", "2012-02", "2012-03"], // first estimated, rest native, last provisional
  firstViirsIndex: 1, provisionalFrom: 3, cellSize: 0.25,
  cells: [
    { lat: 10.125, lon: 20.125, v: [1.5, 2, 3, 4] },
    { lat: 10.125, lon: 20.375, v: [5, 6, 7, 8] },
    { lat: 10.875, lon: 20.125, v: [9, 9, 9, 9] }, // far north of the AOI used below
  ],
};
const aoi = bbox(20, 10, 20.5, 10.25); // covers the first two cells

describe("csvField / toCsv", () => {
  it("quotes commas, quotes and line breaks and doubles inner quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("cr\rhere")).toBe('"cr\rhere"');
    expect(csvField(null)).toBe("");
    expect(csvField(false)).toBe("false");
    expect(csvField(0)).toBe("0");
  });
  it("starts with a UTF-8 BOM, uses CRLF and keeps non-ASCII text intact", () => {
    const out = toCsv(["a", "b"], [["é,ü", 1]]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out).toBe(`${BOM}a,b\r\n"é,ü",1\r\n`);
  });
});

describe("monthlyCsv", () => {
  const rows = [
    { month: "2011-12", count: 10.456, lo: 8, hi: 15.5, source: "modis_estimated", provisional: false },
    { month: "2012-03", count: 20, lo: 20, hi: 20, source: "viirs_native", provisional: true },
  ];
  const out = monthlyCsv(rows, 'Land of "Fire", North', aoi, "2026-11-15T10:00:00.000Z");
  const lines = out.slice(1).trimEnd().split("\r\n");
  it("has the required columns in order", () => {
    expect(lines[0]).toBe("month,harmonized_count,lower,upper,source,provisional,aoi_description,generated_at");
  });
  it("writes interval, source, provisional flag, AOI description and timestamp, escaped", () => {
    expect(lines[1]).toBe('2011-12,10.46,8,15.5,modis_estimated,false,"Land of ""Fire"", North: bbox west=20 south=10 east=20.5 north=10.25",2026-11-15T10:00:00.000Z');
    expect(lines[2]).toContain("2012-03,20,20,20,viirs_native,true,");
    expect(lines).toHaveLength(3);
  });
  it("describes polygons with their vertex count", () => {
    const poly = { type: "polygon", coordinates: [[20, 10], [21, 10], [21, 11]] };
    expect(monthlyCsv(rows, "R", poly, "t")).toContain('"R: polygon (3 vertices), bounds west=20 south=10 east=21 north=11"');
  });
});

describe("file names", () => {
  it("include the region, AOI bounds and range, and never say hotspot", () => {
    const a = monthlyFileName("zambia", bbox(22, -18, 34, -8), "2015-01", "2025-12");
    expect(a).toBe("fire-harmonize_zambia_monthly-counts_w22_s-18_e34_n-8_2015-01_2025-12.csv");
    const b = cellsFileName("zambia", bbox(22, -18, 34, -8), "2015-01", "2025-12", true);
    expect(b).toBe("fire-harmonize_zambia_cell-counts_w22_s-18_e34_n-8_2015-01_2025-12_capped.csv");
    expect(a + b).not.toMatch(/hotspot/i);
  });
});

describe("cellExportPlan and cellsCsv", () => {
  it("selects the cells in the AOI and the months in the range", () => {
    const plan = cellExportPlan(cellsData, aoi, "2012-01", "2012-03");
    expect(plan.cells).toHaveLength(2);
    expect(plan.monthIdx).toEqual([1, 2, 3]);
    expect(plan.totalRows).toBe(6);
    expect(cellExportPlan(cellsData, bbox(0, 0, 1, 1), "2012-01", "2012-03").totalRows).toBe(0);
    expect(cellExportPlan(cellsData, aoi, "2013-01", "2013-12").totalRows).toBe(0);
  });
  it("writes the required columns with source and provisional flags per month", () => {
    const plan = cellExportPlan(cellsData, aoi, "2011-12", "2012-03");
    const out = cellsCsv(cellsData, plan);
    const lines = out.text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("cell_lat,cell_lon,month,harmonized_count,source,provisional");
    expect(lines[1]).toBe("10.125,20.125,2011-12,1.5,modis_estimated,false");
    expect(lines[2]).toBe("10.125,20.125,2012-01,2,viirs_native,false");
    expect(lines[4]).toBe("10.125,20.125,2012-03,4,viirs_native,true");
    expect(out).toMatchObject({ rows: 8, cellsWritten: 2, capped: false });
  });
  it("caps by whole cells and reports that it did", () => {
    const plan = cellExportPlan(cellsData, aoi, "2011-12", "2012-03"); // 2 cells x 4 months
    expect(cellsCsv(cellsData, plan, 8)).toMatchObject({ rows: 8, cellsWritten: 2, capped: false });
    expect(cellsCsv(cellsData, plan, 7)).toMatchObject({ rows: 4, cellsWritten: 1, capped: true });
    expect(cellsCsv(cellsData, plan, 3)).toMatchObject({ rows: 0, cellsWritten: 0, capped: true });
  });
});
