// What the pipeline measured about a region's MODIS-estimated months, read from meta.json (never typed in by
// hand). The headline number is the median absolute percentage error of a monthly total for rectangles of
// 1-5 degrees, from leave-one-year-out cross-validation on the 2012+ overlap of MODIS and VIIRS. It describes
// the model on years where VIIRS exists; how well it holds for 2002-2011 cannot be checked (the stated
// assumption). TARGET_PCT matches the limit pipeline/03_harmonize.py warns about.
export const TARGET_PCT = 30;

export function accuracyOf(meta, regionId) {
  const r = meta?.regions?.[regionId];
  const aoi = r?.cv?.chosen?.aoi;
  if (!aoi || typeof aoi.median_ape_pct !== "number") return null;
  return {
    medianErrorPct: aoi.median_ape_pct,
    biasPct: aoi.bias_pct,
    model: r.model?.name ?? null,
    fitWindow: r.model?.fitWindow ?? null,
    withinTarget: aoi.median_ape_pct <= TARGET_PCT,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Everything the accuracy panel draws, from meta.json only. Each part is an empty array when meta.json does not
// carry it (an older export, or a model with no monthly ratios), and the panel then leaves that chart out.
//   models: every candidate model's cross-validated error, with the chosen one flagged
//   byYear: the chosen model's error in each held-out year (cross-validation)
//   afterFit: the fitted model on the years after the fit window (Aqua drift), not held out
//   ratios: for the per-calendar-month ratio model, VIIRS counts per MODIS count in each month
export function chartData(meta, regionId) {
  const r = meta?.regions?.[regionId];
  if (!r) return { models: [], byYear: [], afterFit: [], ratios: [] };
  const chosen = r.model?.id;
  const models = Object.entries(r.cv?.allModels ?? {})
    .filter(([, v]) => num(v.median_ape_pct) !== null)
    .map(([id, v]) => ({ id, errorPct: v.median_ape_pct, biasPct: num(v.bias_pct), chosen: id === chosen }));
  const byYear = Object.entries(r.cv?.byYear ?? {})
    .map(([year, v]) => ({ year: Number(year), errorPct: num(v.medianApePct), biasPct: num(v.biasPct) }))
    .filter((d) => d.errorPct !== null)
    .sort((a, b) => a.year - b.year);
  const afterFit = Object.entries(r.driftDiagnostic?.aoiErrorByYearFromDriftStart ?? {})
    .map(([year, v]) => ({ year: Number(year), errorPct: num(typeof v === "object" ? v?.median_ape_pct : v) }))
    .filter((d) => d.errorPct !== null)
    .sort((a, b) => a.year - b.year);
  const ratios = Array.isArray(r.model?.params?.ratios) && r.model.params.ratios.length === 12
    ? r.model.params.ratios.map((value, i) => ({ month: MONTHS[i], ratio: value }))
    : [];
  return { models, byYear, afterFit, ratios };
}
