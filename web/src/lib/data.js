// Fetches the static files written by pipeline/04_export.py. Every failure throws an Error that names
// the file; callers show the message. Nothing is swallowed.
const url = (name) => `${import.meta.env.BASE_URL}data/${name}`;

async function fetchJson(name) {
  const path = url(name);
  let res;
  try {
    res = await fetch(path);
  } catch (err) {
    throw new Error(`Could not load ${path}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${path}: HTTP ${res.status} ${res.statusText}`.trim());
  try {
    return await res.json();
  } catch (err) {
    // a dev/static server that does not have the file often answers with an HTML page
    throw new Error(`${path} is not valid JSON (${err.message}). Has pipeline/04_export.py been run?`);
  }
}

export async function loadRegions() {
  const regions = await fetchJson("regions.json");
  if (!Array.isArray(regions) || regions.length === 0) throw new Error(`${url("regions.json")} has no regions`);
  for (const r of regions) {
    if (!r.id || !Array.isArray(r.bbox) || r.bbox.length !== 4 || r.lo_mult?.length !== 12 || r.hi_mult?.length !== 12) {
      throw new Error(`${url("regions.json")}: region ${r.id ?? "(no id)"} is missing bbox, lo_mult or hi_mult`);
    }
    // sizeClasses are optional (an older export has none), but when present each must be usable.
    for (const c of r.sizeClasses ?? []) {
      if (!c.id || !Number.isFinite(c.minDeg) || !Number.isFinite(c.maxDeg) || c.lo_mult?.length !== 12 || c.hi_mult?.length !== 12) {
        throw new Error(`${url("regions.json")}: region ${r.id} has a size class (${c.id ?? "no id"}) without minDeg, maxDeg, lo_mult or hi_mult`);
      }
    }
  }
  return regions;
}

export const loadMeta = () => fetchJson("meta.json");

// cells_{region}.json plus the region's multipliers and cell size, ready for aggregateSeries.
export async function loadCells(region) {
  const name = `cells_${region.id}.json`;
  const d = await fetchJson(name);
  if (!Array.isArray(d.months) || !Array.isArray(d.cells) || !Number.isInteger(d.firstViirsIndex) || !Number.isInteger(d.provisionalFrom)) {
    throw new Error(`${url(name)} is missing months, cells, firstViirsIndex or provisionalFrom`);
  }
  const bad = d.cells.find((c) => !Array.isArray(c.v) || c.v.length !== d.months.length);
  if (bad) throw new Error(`${url(name)}: a cell's values are not aligned with the ${d.months.length} months`);
  return { ...d, cellSize: region.cellSize, loMult: region.lo_mult, hiMult: region.hi_mult, bbox: region.bbox, sizeClasses: region.sizeClasses ?? null };
}
