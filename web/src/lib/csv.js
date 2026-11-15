// CSV export. Pure functions; the browser download lives in lib/download.js.
import { aoiBounds, cellWeight, pointInPolygon } from "./aggregate.js";
import { aoiSlug, describeAoi } from "./describe.js";

export const CELL_ROW_CAP = 200000;
const BOM = "﻿"; // lets Excel open the file as UTF-8

// RFC 4180: quote a field that holds a comma, quote, CR or LF (or edge whitespace); double any quotes.
export function csvField(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  return BOM + [columns, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const rounded = (x) => String(Math.round(x * 100) / 100);

export const monthlyFileName = (regionId, aoi, start, end) => `fire-harmonize_${regionId}_monthly-counts_${aoiSlug(aoi)}_${start}_${end}.csv`;
export const cellsFileName = (regionId, aoi, start, end, capped) =>
  `fire-harmonize_${regionId}_cell-counts_${aoiSlug(aoi)}_${start}_${end}${capped ? "_capped" : ""}.csv`;

// rows: aggregateSeries output already cut to the date range.
export function monthlyCsv(rows, regionName, aoi, generatedAt) {
  const desc = `${regionName}: ${describeAoi(aoi)}`;
  return toCsv(
    ["month", "harmonized_count", "lower", "upper", "source", "provisional", "aoi_description", "generated_at"],
    rows.map((r) => [r.month, rounded(r.count), rounded(r.lo), rounded(r.hi), r.source, r.provisional, desc, generatedAt]),
  );
}

// Cells that belong to the AOI (area weight above 0 for rectangles, centre inside for polygons) and the month
// indices inside the range. Cell values are exported as stored, not area-weighted.
export function cellExportPlan(cellsData, aoi, start, end) {
  const size = cellsData.cellSize ?? 0.25;
  const half = size / 2;
  const [w, s, e, n] = aoiBounds(aoi);
  const cells = cellsData.cells.filter((c) => {
    if (c.lon + half <= w || c.lon - half >= e || c.lat + half <= s || c.lat - half >= n) return false;
    return aoi.type === "bbox" ? cellWeight(c, aoi, size) > 0 : pointInPolygon(c.lon, c.lat, aoi.coordinates);
  });
  const monthIdx = [];
  cellsData.months.forEach((m, i) => { if (m >= start && m <= end) monthIdx.push(i); });
  return { cells, monthIdx, totalRows: cells.length * monthIdx.length };
}

// maxRows keeps whole cells only, so a capped file never holds half a cell's time series.
export function cellsCsv(cellsData, plan, maxRows = Infinity) {
  const perCell = plan.monthIdx.length;
  const nCells = perCell === 0 ? 0 : Math.min(plan.cells.length, Math.floor(maxRows / perCell));
  const rows = [];
  for (const c of plan.cells.slice(0, nCells)) {
    for (const i of plan.monthIdx) {
      rows.push([c.lat, c.lon, cellsData.months[i], c.v[i], i < cellsData.firstViirsIndex ? "modis_estimated" : "viirs_native", i >= cellsData.provisionalFrom]);
    }
  }
  return {
    text: toCsv(["cell_lat", "cell_lon", "month", "harmonized_count", "source", "provisional"], rows),
    rows: rows.length, cellsWritten: nCells, capped: nCells < plan.cells.length,
  };
}
