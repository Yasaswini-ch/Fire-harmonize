// Interval width depends on how big the chosen area is: the pipeline measured the error of its estimates separately
// for areas of different sizes (regions.json carries the multipliers per class, meta.json the measured errors).
// Pure functions, no React. Nothing here is a number of its own: every figure comes from the files.
//
// Classes are by the LONGER side of the area in degrees. An area that covers the whole region uses the class "region".
// Areas larger than the largest measured class (but not the whole region) use that largest class, the wider interval.
// Areas smaller than the smallest measured class (the pipeline only sampled areas of 1 degree or more) use the
// smallest class, and the notice says they were not measured.
import { monthLabel } from "./format.js";

export const SMALL_AREA_DEG = 2; // below this longer side the "small area" notice is shown
export const FEW_SAMPLE_AREAS = 30; // fewer sample areas than this and the notice says the figure is shaky
const EPS = 1e-6;

function bounds(aoi) {
  if (aoi.type === "bbox") return [aoi.west, aoi.south, aoi.east, aoi.north];
  const xs = aoi.coordinates.map((p) => p[0]);
  const ys = aoi.coordinates.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function longerSideDeg(aoi) {
  const [w, s, e, n] = bounds(aoi);
  return Math.max(e - w, n - s);
}

function coversRegion(aoi, bbox) {
  const [w, s, e, n] = bounds(aoi);
  return w <= bbox[0] + EPS && s <= bbox[1] + EPS && e >= bbox[2] - EPS && n >= bbox[3] - EPS;
}

// region: a regions.json entry ({ bbox, sizeClasses: [{ id, minDeg, maxDeg, lo_mult, hi_mult }] }), or the same
// fields on the loaded cells payload. Returns the class object, or null when the region has no size classes
// (an older export), in which case callers fall back to the region-wide multipliers.
export function sizeClassFor(aoi, region) {
  const classes = region?.sizeClasses;
  if (!Array.isArray(classes) || classes.length === 0) return null;
  const whole = classes.find((c) => c.id === "region");
  if (whole && region.bbox && coversRegion(aoi, region.bbox)) return whole;
  const sized = classes.filter((c) => c.id !== "region").sort((a, b) => a.minDeg - b.minDeg);
  if (sized.length === 0) return null;
  const side = longerSideDeg(aoi);
  return sized.find((c) => side < c.maxDeg) ?? sized[sized.length - 1];
}

// The notice for small areas, or null. `meta` is meta.json, `region` the regions.json entry, `estimatedRange` the
// first and last month that are MODIS estimates. The measured error comes from meta.json only; when it is not
// there the notice says so instead of showing a number.
export function smallAreaNotice({ meta, regionId, aoi, region, estimatedRange = null }) {
  const side = longerSideDeg(aoi);
  if (side >= SMALL_AREA_DEG) return null;
  const cls = sizeClassFor(aoi, region);
  const stats = meta?.regions?.[regionId]?.sizeClasses?.find((c) => c.id === cls?.id);
  const period = estimatedRange ? `${monthLabel(estimatedRange[0])} to ${monthLabel(estimatedRange[1])}` : null;
  const text = `Estimates for ${period ?? "the early years"} are less certain for small areas. See the uncertainty range.`;
  const measured = typeof stats?.medianApePct === "number"
    ? `Measured typical error for areas of ${stats.minDeg} to ${stats.maxDeg} degrees: ${Math.round(stats.medianApePct)}% (median).`
    : "Measured typical error for this size: not in meta.json.";
  const thin = typeof stats?.medianActualCountNonzero === "number" && typeof stats?.countWeightedErrorPct === "number"
    ? `A typical month in areas this size has about ${Math.round(stats.medianActualCountNonzero)} detections, so percentages swing widely; counted by total detections the error is ${Math.round(stats.countWeightedErrorPct)}%.`
    : null;
  const fewSamples = typeof stats?.nAois === "number" && stats.nAois < FEW_SAMPLE_AREAS
    ? `This figure rests on only ${stats.nAois} sample areas.`
    : null;
  const unmeasured = stats && side < stats.minDeg
    ? `Areas smaller than ${stats.minDeg} degrees were not measured, so this is the figure for the smallest size we did measure.`
    : null;
  return { text, measured, thin, fewSamples, unmeasured };
}
