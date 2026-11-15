import { aoiBounds } from "./aggregate.js";

const r3 = (x) => String(Math.round(x * 1000) / 1000);

// "bbox west=-126 south=32 east=-112 north=52" or "polygon (5 vertices), bounds west=... " for CSV and image headers.
export function describeAoi(aoi) {
  const [w, s, e, n] = aoiBounds(aoi);
  const bounds = `west=${r3(w)} south=${r3(s)} east=${r3(e)} north=${r3(n)}`;
  return aoi.type === "bbox" ? `bbox ${bounds}` : `polygon (${aoi.coordinates.length} vertices), bounds ${bounds}`;
}

// File-name-safe bounds, e.g. "w-126_s32_e-112_n52" (polygons use their bounding box).
export function aoiSlug(aoi) {
  const [w, s, e, n] = aoiBounds(aoi);
  return `w${r3(w)}_s${r3(s)}_e${r3(e)}_n${r3(n)}`;
}
