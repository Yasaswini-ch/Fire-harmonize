import { monthLabel } from "./format.js";

// The "false jump" chart: a region's raw monthly counts spliced together as they are (Aqua MODIS before VIIRS starts, VIIRS
// after) against the harmonized series. Everything comes from meta.json (regions[id].rawVsHarmonized, written by
// pipeline/04_export.py). Whole region only: the raw counts per cell are not exported.

const isNums = (a, n) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === "number" && Number.isFinite(v));

// Sum of the 12 months from `from` over the sum of the 12 months before it; null when either window is missing or empty.
export function yearRatio(values, from) {
  if (!Number.isInteger(from) || from < 12 || from + 12 > values.length) return null;
  const sum = (a, b) => values.slice(a, b).reduce((s, v) => s + v, 0);
  const before = sum(from - 12, from);
  return before > 0 ? sum(from, from + 12) / before : null;
}

// Returns null when meta.json has no usable series (an older export), and the page then leaves the chart out.
export function falseJumpOf(meta, regionId) {
  const s = meta?.regions?.[regionId]?.rawVsHarmonized;
  const n = s?.months?.length;
  const fv = s?.firstViirsIndex;
  if (!n || !Number.isInteger(fv) || fv < 1 || fv >= n) return null;
  if (!["raw", "harmonized", "lo", "hi"].every((k) => isNums(s[k], n))) return null;
  const points = s.months.map((month, i) => ({
    month, raw: s.raw[i], harmonized: s.harmonized[i], lo: s.lo[i], hi: s.hi[i], estimated: i < fv,
  }));
  const rawRatio = yearRatio(s.raw, fv);
  const harmonizedRatio = yearRatio(s.harmonized, fv);
  return {
    points, firstViirsMonth: s.months[fv], rawRatio, harmonizedRatio,
    beforeFrom: fv >= 12 ? s.months[fv - 12] : null, afterTo: fv + 12 <= n ? s.months[fv + 11] : null,
  };
}

const times = (x) => `${x >= 10 ? Math.round(x) : x.toFixed(1)} times`;

// One plain-language sentence pair, with the numbers read from the series. Null when the comparison cannot be made.
export function jumpText(jump, regionName) {
  if (!jump || jump.rawRatio === null || jump.harmonizedRatio === null) return null;
  return `In the raw record for ${regionName}, the 12 months from ${monthLabel(jump.firstViirsMonth)}, when VIIRS starts, hold ${times(jump.rawRatio)} the `
    + `detections of the 12 months before. After harmonizing, the same comparison gives ${times(jump.harmonizedRatio)}. What is left is real change `
    + "from one year to the next plus the uncertainty of the estimated months.";
}
