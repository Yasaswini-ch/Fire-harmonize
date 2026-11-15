// Pure functions, no React. Sums grid-cell series over an area of interest (AOI).
//
// AOI shapes (lon/lat, degrees):
//   { type: "bbox", west, south, east, north }
//   { type: "polygon", coordinates: [[lon, lat], ...] }   one ring, open or closed
//
// cellsData is the cells_{region}.json payload plus the region's multipliers:
//   { months, firstViirsIndex, provisionalFrom, cells: [{lat, lon, v}], loMult, hiMult, cellSize }
// (data.js adds loMult/hiMult/cellSize from regions.json.) Cell lat/lon are cell centres.

import { sizeClassFor } from "./sizeClass.js";

export const CELL_SIZE = 0.25;

// Ray casting. Points exactly on an edge may fall either way; cell centres sit on the 0.125 grid so
// this only matters for polygons drawn through them, where either answer is defensible.
export function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function aoiBounds(aoi) {
  if (aoi.type === "bbox") return [aoi.west, aoi.south, aoi.east, aoi.north];
  const xs = aoi.coordinates.map((p) => p[0]);
  const ys = aoi.coordinates.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Rectangles: fraction of the cell's area that overlaps the AOI. This assumes detections are spread
// evenly inside a cell. Polygons: 1 if the cell centre is inside, else 0 (no partial weights).
export function cellWeight(cell, aoi, size = CELL_SIZE) {
  if (aoi.type === "bbox") {
    const half = size / 2;
    const w = Math.min(cell.lon + half, aoi.east) - Math.max(cell.lon - half, aoi.west);
    const h = Math.min(cell.lat + half, aoi.north) - Math.max(cell.lat - half, aoi.south);
    return w > 0 && h > 0 ? (w * h) / (size * size) : 0;
  }
  return pointInPolygon(cell.lon, cell.lat, aoi.coordinates) ? 1 : 0;
}

// Number of grid cells the AOI touches (whether or not they hold detections). Used for the
// "smaller than the grid" notice. For polygons this counts grid cells whose centre is inside.
export function gridCellsCovered(aoi, size = CELL_SIZE) {
  const eps = 1e-9;
  const [w, s, e, n] = aoiBounds(aoi);
  const col0 = Math.floor(w / size + eps);
  const col1 = Math.ceil(e / size - eps);
  const row0 = Math.floor(s / size + eps);
  const row1 = Math.ceil(n / size - eps);
  if (aoi.type === "bbox") return Math.max(0, col1 - col0) * Math.max(0, row1 - row0);
  let count = 0;
  for (let c = col0; c < col1; c++) {
    for (let r = row0; r < row1; r++) {
      if (pointInPolygon((c + 0.5) * size, (r + 0.5) * size, aoi.coordinates)) count++;
    }
  }
  return count;
}

// [{ month: "YYYY-MM", count, lo, hi, source, provisional }] for every month in cellsData.
// lo/hi apply the calendar-month multipliers of the AOI's size class to MODIS-estimated months only; VIIRS native
// months have lo = hi = count. An AOI with no cells gives all zeros (not an empty array).
export function aggregateSeries(cellsData, aoi) {
  const { months, cells, firstViirsIndex, provisionalFrom } = cellsData;
  // The interval width depends on the size of the area (see sizeClass.js); an export without size classes
  // falls back to the region-wide multipliers.
  const cls = sizeClassFor(aoi, cellsData);
  const loMult = cls?.lo_mult ?? cellsData.loMult;
  const hiMult = cls?.hi_mult ?? cellsData.hiMult;
  const zeroHi = cls?.zeroPredHi ?? 0; // upper end of the range for an estimated month with 0 predicted detections
  const size = cellsData.cellSize ?? CELL_SIZE;
  const half = size / 2;
  const [w, s, e, n] = aoiBounds(aoi);
  const totals = new Float64Array(months.length);
  for (const cell of cells) {
    if (cell.lon + half <= w || cell.lon - half >= e || cell.lat + half <= s || cell.lat - half >= n) continue;
    const weight = cellWeight(cell, aoi, size);
    if (weight === 0) continue;
    for (let i = 0; i < totals.length; i++) totals[i] += weight * cell.v[i];
  }
  return months.map((month, i) => {
    const estimated = i < firstViirsIndex;
    const moy = Number(month.slice(5, 7)) - 1;
    const count = totals[i];
    return {
      month,
      count,
      lo: estimated ? count * loMult[moy] : count,
      hi: estimated ? (count === 0 ? zeroHi : count * hiMult[moy]) : count,
      source: estimated ? "modis_estimated" : "viirs_native",
      provisional: i >= provisionalFrom,
    };
  });
}
