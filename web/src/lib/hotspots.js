// What the map draws: one square per 0.25 degree grid cell that has detections in the chosen month, coloured by
// the count. Pure helpers over the cells_{region}.json payload (see data.js), no Leaflet and no React, so they can
// be tested. The colour ramp is Inferno (colour-blind safe), the same as the globe.
import { interpolateInferno } from "d3-scale-chromatic";

// The count that maps to the top of the ramp: the 99th percentile of the non-zero cell-months, so a few extreme
// months do not wash everything else out. Sampled every third month to keep it quick.
export function rampMax(cells) {
  const vals = [];
  for (const c of cells) for (let i = 0; i < c.v.length; i += 3) if (c.v[i] > 0) vals.push(c.v[i]);
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.99)] || 1;
}

// Square-root scale: counts are very skewed, and a linear ramp would leave most cells looking empty.
export function hotspotColor(v, max) {
  const t = Math.sqrt(Math.min(Math.max(v, 0) / max, 1));
  return interpolateInferno(0.18 + 0.82 * t);
}

// Indices into cellsData.months that fall between two "YYYY-MM" strings, inclusive.
export function monthIndices(cellsData, from, to) {
  const out = [];
  cellsData.months.forEach((m, i) => { if (m >= from && m <= to) out.push(i); });
  return out;
}

// The busiest month in the range by total detections over all cells, or null when the range has none.
export function peakMonthIndex(cellsData, from, to) {
  let best = null;
  let bestTotal = 0;
  for (const i of monthIndices(cellsData, from, to)) {
    let total = 0;
    for (const c of cellsData.cells) total += c.v[i];
    if (total > bestTotal) { bestTotal = total; best = i; }
  }
  return best;
}

export function cellsAt(cellsData, index) {
  return cellsData.cells.filter((c) => c.v[index] > 0);
}

export function monthSource(cellsData, index) {
  if (index >= cellsData.provisionalFrom) return "provisional";
  if (index < cellsData.firstViirsIndex) return "modis_estimated";
  return "viirs_native";
}

export const SOURCE_LABEL = {
  modis_estimated: "MODIS-estimated (approximate)",
  provisional: "provisional (near real time)",
  viirs_native: "VIIRS native",
};
