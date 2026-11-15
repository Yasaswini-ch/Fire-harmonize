// Pure AOI helpers: validation, clipping to a region, region matching. No React.
import { aoiBounds } from "./aggregate.js";

export const bboxAoi = (west, south, east, north) => ({ type: "bbox", west, south, east, north });
export const regionAoi = (region) => bboxAoi(...region.bbox); // region.bbox = [west, south, east, north]

// fields: { minLat, maxLat, minLon, maxLon } as strings or numbers.
export function validateBboxInput(fields) {
  const errors = {};
  const v = {};
  const limits = { minLat: 90, maxLat: 90, minLon: 180, maxLon: 180 };
  for (const [key, lim] of Object.entries(limits)) {
    const raw = String(fields[key] ?? "").trim();
    const num = Number(raw);
    if (raw === "" || !Number.isFinite(num)) errors[key] = "Enter a number";
    else if (Math.abs(num) > lim) errors[key] = `Must be between -${lim} and ${lim}`;
    else v[key] = num;
  }
  if (!errors.minLat && !errors.maxLat && v.minLat >= v.maxLat) errors.maxLat = "North must be greater than south";
  if (!errors.minLon && !errors.maxLon && v.minLon >= v.maxLon) errors.maxLon = "East must be greater than west";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors, aoi: bboxAoi(v.minLon, v.minLat, v.maxLon, v.maxLat) };
}

// Overlap of two [w, s, e, n] boxes, or null when they do not share any area.
export function intersectBbox(a, b) {
  const w = Math.max(a[0], b[0]);
  const s = Math.max(a[1], b[1]);
  const e = Math.min(a[2], b[2]);
  const n = Math.min(a[3], b[3]);
  return w < e && s < n ? [w, s, e, n] : null;
}

// Sutherland-Hodgman against one rectangle (a convex clip region).
export function clipPolygonToBbox(ring, [w, s, e, n]) {
  const edges = [
    { inside: (p) => p[0] >= w, cut: (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= e, cut: (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= s, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s] },
    { inside: (p) => p[1] <= n, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n] },
  ];
  let out = ring;
  for (const { inside, cut } of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cut(prev, cur));
      }
    }
    if (!out.length) return [];
  }
  return out;
}

// Clip an AOI to a region bbox. Returns { aoi, wasClipped } or null when there is no overlap.
export function clipAoi(aoi, regionBbox) {
  if (aoi.type === "bbox") {
    const box = intersectBbox(aoiBounds(aoi), regionBbox);
    if (!box) return null;
    const [w, s, e, n] = aoiBounds(aoi);
    const wasClipped = box[0] > w || box[1] > s || box[2] < e || box[3] < n;
    return { aoi: bboxAoi(...box), wasClipped };
  }
  const ring = clipPolygonToBbox(aoi.coordinates, regionBbox);
  if (ring.length < 3) return null;
  const [w, s, e, n] = regionBbox;
  const wasClipped = aoi.coordinates.some(([x, y]) => x < w || x > e || y < s || y > n);
  return { aoi: { type: "polygon", coordinates: ring }, wasClipped };
}

// Every region the AOI overlaps, each with the AOI clipped to that region.
export function regionsForAoi(aoi, regions) {
  const out = [];
  for (const region of regions) {
    const clipped = clipAoi(aoi, region.bbox);
    if (clipped) out.push({ region, ...clipped });
  }
  return out;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Error message for a start/end month range, or null when it is usable. YYYY-MM strings compare correctly.
export function rangeError(region, start, end) {
  if (!MONTH.test(start) || !MONTH.test(end)) return "Enter both months as YYYY-MM.";
  if (start > end) return "The start month must not be after the end month.";
  if (end < region.firstMonth || start > region.lastMonth) return `Data for this region covers ${region.firstMonth} to ${region.lastMonth}.`;
  return null;
}

export function aoiFields(aoi) {
  const [w, s, e, n] = aoiBounds(aoi);
  const r = (x) => String(Math.round(x * 10000) / 10000);
  return { minLat: r(s), maxLat: r(n), minLon: r(w), maxLon: r(e) };
}

// Leaflet-draw output -> AOI. Longitudes/latitudes are clamped to the valid range because the map can wrap.
const clampLon = (x) => Math.max(-180, Math.min(180, x));
const clampLat = (y) => Math.max(-90, Math.min(90, y));
export function aoiFromLatLngs(kind, latlngs) {
  if (kind === "rectangle") {
    const lats = latlngs.map((p) => clampLat(p.lat));
    const lons = latlngs.map((p) => clampLon(p.lng));
    return bboxAoi(Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
  }
  return { type: "polygon", coordinates: latlngs.map((p) => [clampLon(p.lng), clampLat(p.lat)]) };
}
