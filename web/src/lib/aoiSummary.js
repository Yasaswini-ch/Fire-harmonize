// A short, readable line for an area, for the page header: "12° × 10° · 22°E to 34°E · 18°S to 8°S".
// (describe.js has the long, exact text that goes into CSV and image headers.)
const trim = (x) => String(Math.round(x * 100) / 100);
const lon = (x) => `${trim(Math.abs(x))}°${x >= 0 ? "E" : "W"}`;
const lat = (x) => `${trim(Math.abs(x))}°${x >= 0 ? "N" : "S"}`;

function bounds(aoi) {
  if (aoi.type === "bbox") return [aoi.west, aoi.south, aoi.east, aoi.north];
  const xs = aoi.coordinates.map((p) => p[0]);
  const ys = aoi.coordinates.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function aoiSummary(aoi) {
  const [w, s, e, n] = bounds(aoi);
  const size = `${trim(e - w)}° × ${trim(n - s)}°`;
  const where = `${lon(w)} to ${lon(e)} · ${lat(s)} to ${lat(n)}`;
  return aoi.type === "polygon" ? `Polygon within ${size} · ${where}` : `${size} · ${where}`;
}
