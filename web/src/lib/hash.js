// Shareable state in the URL hash: #region=zambia&aoi=bbox:22,-18,34,-8&from=2015-01&to=2025-12
// Polygons: aoi=poly:lon,lat;lon,lat;... Anything that fails validation is ignored, never trusted.
import { regionAoi, regionsForAoi, rangeError } from "./aoi.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_VERTICES = 500;
const r4 = (x) => String(Math.round(x * 10000) / 10000);

export function formatHash({ regionId, aoi, start, end }) {
  const a = aoi.type === "bbox"
    ? `bbox:${[aoi.west, aoi.south, aoi.east, aoi.north].map(r4).join(",")}`
    : `poly:${aoi.coordinates.map(([x, y]) => `${r4(x)},${r4(y)}`).join(";")}`;
  return `#region=${regionId}&aoi=${a}&from=${start}&to=${end}`;
}

function parseNum(s, lim) {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : null;
}

export function parseAoi(text) {
  if (typeof text !== "string") return null;
  if (text.startsWith("bbox:")) {
    const p = text.slice(5).split(",");
    if (p.length !== 4) return null;
    const [w, s, e, n] = [parseNum(p[0], 180), parseNum(p[1], 90), parseNum(p[2], 180), parseNum(p[3], 90)];
    if ([w, s, e, n].includes(null) || w >= e || s >= n) return null;
    return { type: "bbox", west: w, south: s, east: e, north: n };
  }
  if (text.startsWith("poly:")) {
    const pts = text.slice(5).split(";").map((v) => v.split(","));
    if (pts.length < 3 || pts.length > MAX_VERTICES) return null;
    const coordinates = pts.map((p) => (p.length === 2 ? [parseNum(p[0], 180), parseNum(p[1], 90)] : [null, null]));
    return coordinates.some((c) => c[0] === null || c[1] === null) ? null : { type: "polygon", coordinates };
  }
  return null;
}

function readParams(hash) {
  const out = {};
  for (const part of String(hash).replace(/^#/, "").split("&")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    try { out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch { /* malformed escape: ignore the key */ }
  }
  return out;
}

// Full state { regionId, aoi, start, end } from a hash, or null when it holds nothing usable.
export function stateFromHash(hash, regions) {
  const p = readParams(hash);
  const hashRegion = regions.find((r) => r.id === p.region) ?? null;
  const aoi = parseAoi(p.aoi);
  if (!hashRegion && !aoi) return null;
  const matches = aoi ? regionsForAoi(aoi, regions) : [];
  const region = (hashRegion && (!aoi || matches.some((m) => m.region.id === hashRegion.id)) ? hashRegion : null) ?? matches[0]?.region ?? hashRegion ?? regions[0];
  let start = MONTH.test(p.from ?? "") ? p.from : region.firstMonth;
  let end = MONTH.test(p.to ?? "") ? p.to : region.lastMonth;
  if (rangeError(region, start, end)) { start = region.firstMonth; end = region.lastMonth; }
  return { regionId: region.id, aoi: aoi ?? regionAoi(region), start, end };
}
