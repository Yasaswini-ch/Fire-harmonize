"""Export the static files the web app loads into web/public/data/.

Reads  data/processed/harmonized_cells.parquet, data/processed/validation.json,
       data/interim/prepare_report.json, data/raw/availability.csv, config/regions.json
Writes web/public/data/regions.json, cells_{region}.json, meta.json
       web/public/figures/{region}_{raw,validation,drift}.png (copied from data/interim and data/processed)

cells_{region}.json: {"months": [...], "firstViirsIndex": n, "provisionalFrom": n,
                      "cells": [{"lat", "lon", "v": [...]}]}
Months before firstViirsIndex are MODIS estimates (one decimal, interval = v * lo/hi multiplier of
the calendar month, see regions.json); months from firstViirsIndex are VIIRS native (integers, or one
decimal if NOAA-20 had to be rescaled); months from provisionalFrom are provisional NRT.

Run:  python pipeline/04_export.py
"""
import hashlib
import json
import shutil
from datetime import date

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from common import INTERIM, PROCESSED, RAW, ROOT, load_regions

OUT = ROOT / "web" / "public" / "data"
FIGURES = ROOT / "web" / "public" / "figures"
# Figures the pipeline already draws, shown in the app (Results and method tab) and in the README: where each comes from
FIGURE_SOURCES = {"raw": lambda r: INTERIM / f"qa_{r}_raw_monthly.png",
                  "validation": lambda r: PROCESSED / f"validation_{r}.png",
                  "drift": lambda r: PROCESSED / f"drift_{r}.png"}
TARGET_BYTES = 15_000_000
THRESHOLDS = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]  # min total detections a cell needs to be kept
CELL_SIZE = 0.25
MODEL_NAMES = {"A": "single multiplicative ratio", "B": "log1p linear fit",
               "C": "log1p linear fit with month-of-year offset",
               "D": "ratio fitted separately for each calendar month",
               "E": "ratio fitted separately for each calendar month and level of MODIS activity"}
SOURCE_PRODUCTS = [
    {"firmsSource": "MODIS_SP", "role": "Aqua only; estimated VIIRS-equivalent counts before February 2012"},
    {"firmsSource": "VIIRS_SNPP_SP", "role": "VIIRS 375 m reference series (Suomi NPP), standard processing"},
    {"firmsSource": "VIIRS_NOAA20_SP", "role": "VIIRS 375 m (NOAA-20), standard processing; used after Suomi NPP ended"},
    {"firmsSource": "VIIRS_NOAA20_NRT", "role": "VIIRS 375 m (NOAA-20), near real time; provisional months"},
]


def load(path, what):
    if not path.exists():
        raise SystemExit(f"Missing {path} ({what}).")
    return path


def refuse_fixture_inputs(val, prep):
    """Exit if any input came from a fixture, so fixture data can never be exported as real data.
    A fixture is marked by any of: a file named SYNTHETIC in data/, data/raw, data/interim or data/processed;
    "synthetic": true at the top level of validation.json or prepare_report.json; a "synthetic" key set to
    true in the harmonized_cells.parquet schema metadata."""
    found = [str(d / "SYNTHETIC") for d in (ROOT / "data", RAW, INTERIM, PROCESSED) if (d / "SYNTHETIC").exists()]
    found += [f"{name}: \"synthetic\" is {obj['synthetic']!r}" for name, obj in
              (("validation.json", val), ("prepare_report.json", prep)) if obj.get("synthetic") not in (None, False)]
    parquet_meta = pq.read_schema(PROCESSED / "harmonized_cells.parquet").metadata or {}
    if parquet_meta.get(b"synthetic", b"").lower() in (b"true", b"1"):
        found.append("harmonized_cells.parquet: schema metadata synthetic=true")
    if found:
        raise SystemExit("Refusing to export: the inputs are marked as fixture data, and the web app's meta.json would "
                         "say they are real (\"synthetic\": false).\n  " + "\n  ".join(found) +
                         "\nReplace the inputs with real FIRMS data (01_fetch.py to 03_harmonize.py) and remove the marker, "
                         "then run this again.")


def is_integral(a):
    """Absolute test: np.allclose's default relative tolerance would call 5000.04 an integer."""
    return bool(np.allclose(a, np.rint(a), rtol=0, atol=1e-6))


def month_str(ts):
    return f"{ts:%Y-%m}"


# ---------------------------------------------------------------- per region cell matrix

def build_matrix(region, df):
    """Return months, source boundaries, cell keys and the (cells x months) value matrix. Fails loudly
    on anything that would force the exporter to invent data (gaps, incomplete grid, mixed sources)."""
    months = pd.date_range(df["month"].min(), df["month"].max(), freq="MS")
    missing = set(months) - set(df["month"].unique())
    if missing:
        raise SystemExit(f"{region}: months with no data inside the series: {sorted(month_str(m) for m in missing)}")
    per_month = df.groupby("month").agg(n_src=("source", "nunique"), n_prov=("provisional", "nunique"),
                                        src=("source", "first"), prov=("provisional", "first"))
    if (per_month["n_src"] > 1).any() or (per_month["n_prov"] > 1).any():
        raise SystemExit(f"{region}: source/provisional flag differs between cells within a month.")
    native = (per_month.loc[months, "src"] == "viirs_native").values
    prov = per_month.loc[months, "prov"].values.astype(bool)
    if not native.any():
        raise SystemExit(f"{region}: no VIIRS native months.")
    first_viirs = int(np.argmax(native))
    prov_from = int(np.argmax(prov)) if prov.any() else len(months)
    if not native[first_viirs:].all() or native[:first_viirs].any():
        raise SystemExit(f"{region}: sources are not ordered estimated -> native; header indices would be wrong.")
    if not prov[prov_from:].all() or prov[:prov_from].any() or (prov & ~native).any():
        raise SystemExit(f"{region}: provisional months are not a native tail.")

    uniq = df[["cell_lat", "cell_lon"]].drop_duplicates().sort_values(["cell_lat", "cell_lon"]).reset_index(drop=True)
    if len(df) != len(uniq) * len(months):
        raise SystemExit(f"{region}: cell x month grid is incomplete ({len(df)} rows vs {len(uniq)} x {len(months)}); "
                         "zeros would be fabricated.")
    ci = pd.MultiIndex.from_frame(uniq).get_indexer(pd.MultiIndex.from_frame(df[["cell_lat", "cell_lon"]]))
    mi = (df["month"].dt.year - months[0].year) * 12 + df["month"].dt.month - months[0].month
    mat = np.zeros((len(uniq), len(months)))
    mat[ci, mi.values] = df["harmonized"].values
    return months, first_viirs, prov_from, prov, uniq, mat


def cells_payload(months, first_viirs, prov_from, uniq, mat, threshold):
    """Cells json dict for one region, keeping cells whose total >= threshold (and > 0)."""
    total = mat.sum(1)
    keep = (total > 0) & (total >= threshold)
    est = np.round(mat[:, :first_viirs], 1)
    nat = mat[:, first_viirs:]
    nat = np.rint(nat).astype(np.int64) if is_integral(nat) else np.round(nat, 1)
    cells = [{"lat": float(uniq.cell_lat[i]), "lon": float(uniq.cell_lon[i]), "v": est[i].tolist() + nat[i].tolist()}
             for i in np.nonzero(keep)[0]]
    payload = {"months": [month_str(m) for m in months], "firstViirsIndex": first_viirs,
               "provisionalFrom": prov_from, "cells": cells}
    return payload, keep, total


def dumps(obj):
    return json.dumps(obj, separators=(",", ":"))


# ---------------------------------------------------------------- meta + regions

def region_entries(regions, info):
    out = []
    for region, i in info.items():
        out.append({"id": region, "name": regions[region]["name"], "bbox": regions[region]["bbox"], "cellSize": CELL_SIZE,
                    "firstMonth": month_str(i["months"][0]), "lastMonth": month_str(i["months"][-1]),
                    "provisionalMonths": [month_str(m) for m, p in zip(i["months"], i["prov"]) if p],
                    "lo_mult": i["val"]["lo_mult_by_month"], "hi_mult": i["val"]["hi_mult_by_month"],
                    "sizeClasses": [{"id": c["id"], "label": c["label"], "minDeg": c["min_deg"], "maxDeg": c["max_deg"],
                                     "lo_mult": c["lo_mult_by_month"], "hi_mult": c["hi_mult_by_month"],
                                     "zeroPredHi": c["zero_pred_hi_count"],
                                     "pooledFallback": c["multipliers_are_pooled_fallback"]}
                                    for c in i["val"]["size_classes"]],
                    "multiplierIndex": "calendar month, January = index 0; sizeClasses pick the multipliers by the longer side "
                                       "of the AOI in degrees, and the class 'region' is for an AOI covering the whole region. "
                                       "zeroPredHi is the upper end of the range, in detections, for a month the model estimates as 0"})
    return out


def methods_summary(snpp_end):
    return " ".join([
        "Fire detections come from NASA FIRMS: the MODIS instrument on the Aqua satellite (from 2002) and the 375 m "
        f"VIIRS instruments on Suomi NPP (used through {snpp_end}) and NOAA-20.",
        "Only detections classed as presumed vegetation fires are counted, low-confidence detections are dropped, and "
        "the rest are summed into 0.25 degree cells by calendar month.",
        "VIIRS has smaller pixels and detects many more fires than MODIS, so MODIS counts are converted to "
        "VIIRS-equivalent counts with a statistical model fitted on the 2012 to 2021 overlap of the two sensors and "
        "tested by leaving each year out in turn.",
        "That relationship is assumed to hold for 2002 to 2011, which cannot be checked and is the main limit of the "
        "early record; Aqua's overpass has drifted later since 2021 to 2022, so the model is not used after 2021.",
        "Months before February 2012 are therefore model estimates and are shown with an empirical range (the 10th to "
        "90th percentile of past errors on held-out years), which is not a formal confidence interval.",
        f"From February 2012 the series uses Suomi NPP counts directly, and months after Suomi NPP ended ({snpp_end}) come "
        "from NOAA-20, compared with Suomi NPP over the months both flew (the ratio and whether any scaling was applied "
        "are listed per region).",
        "The most recent months use near-real-time NOAA-20 data, are marked provisional and may change when standard "
        "processing replaces them; static sources such as gas flares are removed from them using a mask built from "
        "standard-processing files.",
        "Harmonized values are model estimates, not observations."])


def region_meta(region, val, prep):
    chosen = val["chosen_model"]
    bridge = val.get("bridge_noaa20_vs_snpp")
    drift = val["drift"]
    cv_ape = [v["median_ape_pct"] for v in drift["cv_by_year"].values()]
    return {
        "model": {"id": chosen, "name": MODEL_NAMES[chosen], "params": val["params"], "fitWindow": val["fit_window"],
                  "cvFolds": val["n_cv_folds"]},
        "cv": {"chosen": val["models"][chosen],
               "allModels": {m: v["aoi"] for m, v in val["models"].items()},
               "byYear": {y: {"medianApePct": v["median_ape_pct"], "biasPct": v["bias_pct"]}
                          for y, v in drift["cv_by_year"].items()},
               "continuity2012to2013MeanPctDiff": val["continuity_2012_2013_mean_pct_diff"],
               "interval": val["interval_note"]},
        "warnings": val["warnings"],
        "modelSelection": {"rule": val["model_selection"]["rule"], "maxAbsBiasPct": val["model_selection"]["max_abs_bias_pct"],
                           "candidates": [{"model": c["model"], "name": c["name"], "medianApePct": c["median_ape_pct"],
                                           "biasPct": c["bias_pct"], "qualifies": c["qualifies"]}
                                          for c in val["model_selection"]["candidates"]],
                           "chosen": val["model_selection"]["chosen"], "noneQualified": val["model_selection"]["none_qualified"],
                           "note": val["model_selection"]["note"]},
        "sizeClasses": [{"id": c["id"], "label": c["label"], "minDeg": c["min_deg"], "maxDeg": c["max_deg"], "nAois": c["n_aois"],
                         "medianApePct": c["median_ape_pct"], "biasPct": c["bias_pct"],
                         "countWeightedErrorPct": c["count_weighted_error_pct"],
                         "medianActualCountNonzero": c["median_actual_count_nonzero"],
                         "medianActualCountAll": c["median_actual_count_all"], "nPairs": c["n_pairs"], "nNonzero": c["n_nonzero"],
                         "zeroPredHi": c["zero_pred_hi_count"],
                         "coverage": {"targetPct": c["coverage"]["target_pct"], "heldOutYearsPct": c["coverage"]["held_out_years_pct"],
                                      "heldOutYearsPctPredictedPositive": c["coverage"]["held_out_years_pct_predicted_positive"],
                                      "zeroPredSharePct": c["coverage"]["zero_pred_share_pct"],
                                      "inSamplePct": c["coverage"]["in_sample_pct"], "n": c["coverage"]["n"]},
                         "pooledMultipliers": c["multipliers_are_pooled_fallback"]} for c in val["size_classes"]],
        "bridgeNoaa20ToSnpp": None if bridge is None else {
            "overlap": bridge["overlap"], "aoiMedianRatio": bridge["aoi_median_ratio"],
            "regionMonthlyMedianRatio": bridge["region_ratio_median"],
            "scalingApplied": bridge["scale_applied"] != 1.0, "scaleFactor": bridge["scale_applied"],
            "recentMonths": bridge.get("recent_months"), "recentRatioMedian": bridge.get("recent_ratio_median"),
            "recentOutsideTolerance": bridge.get("recent_outside_tolerance")},
        "driftDiagnostic": {"note": "Aqua's overpass has drifted later since 2021 to 2022; model fitted 2012-2021 applied to later years; "
                                    "diagnostic only",
                            "aoiErrorByYearFromDriftStart": drift["fitted_model_on_drift_years"],
                            "cvMedianApeRangePct": [min(cv_ape), max(cv_ape)]},
        "staticMask": prep["regions"][region]["static_mask"],
    }


# ---------------------------------------------------------------- validation

def validate(region, df, months, path):
    """Reload the written json, sum all cells per month, compare with the parquet for the same cells."""
    obj = json.loads(path.read_text(encoding="utf-8"))
    n = len(obj["months"])
    if obj["months"] != [month_str(m) for m in months] or any(len(c["v"]) != n for c in obj["cells"]):
        print(f"{region}: FAIL (arrays not aligned with months)")
        return False
    arr = np.array([c["v"] for c in obj["cells"]], dtype=float)
    got = arr.sum(0)
    kept = pd.MultiIndex.from_tuples([(c["lat"], c["lon"]) for c in obj["cells"]])
    sub = df[pd.MultiIndex.from_frame(df[["cell_lat", "cell_lon"]]).isin(kept)]
    want = sub.groupby("month")["harmonized"].sum().reindex(months).values
    decimals_est = obj["firstViirsIndex"]
    # Tolerance = worst-case rounding: 0.05 per non-zero cell-month rounded to one decimal. (Not a random-error
    # bound: estimated values are multiples of the model ratio, so their rounding errors do not cancel.)
    # Integer native months must match exactly.
    tol = np.full(n, 1e-6)
    tol[:decimals_est] += 0.05 * (arr[:, :decimals_est] != 0).sum(0)
    if not is_integral(df["harmonized"].values[df["source"].values == "viirs_native"]):
        tol[decimals_est:] += 0.05 * (arr[:, decimals_est:] != 0).sum(0)
    diff = np.abs(got - want)
    ok = bool((diff <= tol).all())
    full = df.groupby("month")["harmonized"].sum().reindex(months).values
    print(f"{region}: {'PASS' if ok else 'FAIL'}  max |diff| {diff.max():.4f} detections over {n} months "
          f"(max relative {np.max(diff / np.maximum(want, 1)):.2e}); kept cells hold "
          f"{100 * got.sum() / full.sum():.4f}% of the region's harmonized detections")
    return ok


def mask_validation(prep):
    """The measured recall and false-drop of the static-source mask: data/processed/mask_validation.json (written by
    05_validate_mask.py) if it exists, else whatever the prepare report carries from the older one-off run."""
    path = PROCESSED / "mask_validation.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return prep.get("static_mask_validation")


def raw_vs_harmonized(h, months, first_viirs):
    """Region monthly totals for the "false jump" chart. `raw` is what a plain splice of the unharmonized counts shows:
    Aqua MODIS before the first VIIRS month, VIIRS (unscaled) from then on. `harmonized` is the exported series, with the
    range of its estimated months. Whole region only: the per-cell raw counts are not exported, so this cannot follow a
    drawn area."""
    g = h.groupby("month").agg(harmonized=("harmonized", "sum"), lo=("lo", "sum"), hi=("hi", "sum"),
                               modis=("modis_count", "sum"), viirs=("viirs_count", "sum")).reindex(months)
    if g.isna().any().any():
        raise SystemExit("raw_vs_harmonized: a month is missing from the harmonized table.")
    raw = np.where(np.arange(len(months)) < first_viirs, g["modis"], g["viirs"])
    return {"months": [month_str(m) for m in months], "firstViirsIndex": int(first_viirs),
            "raw": [int(round(v)) for v in raw], "harmonized": g["harmonized"].round(1).tolist(),
            "lo": g["lo"].round(1).tolist(), "hi": g["hi"].round(1).tolist(),
            "rawNote": "Aqua MODIS counts before the first VIIRS month and Suomi NPP / NOAA-20 VIIRS counts from then on, "
                       "unscaled. Whole region."}


def copy_figures(region_ids):
    """Copy the raw-totals, validation and drift pictures of every region to web/public/figures/{region}_{kind}.png,
    so the site and the README show exactly the pictures of the run that produced the numbers."""
    FIGURES.mkdir(parents=True, exist_ok=True)
    for region in region_ids:
        for kind, source in FIGURE_SOURCES.items():
            src = load(source(region), "run 02_prepare.py and 03_harmonize.py")
            shutil.copyfile(src, FIGURES / f"{region}_{kind}.png")
    print(f"\nfigures: copied {len(FIGURE_SOURCES) * len(region_ids)} pictures to {FIGURES}")


# ---------------------------------------------------------------- main

def main():
    regions = load_regions()
    harm = pd.read_parquet(load(PROCESSED / "harmonized_cells.parquet", "run 03_harmonize.py"))
    val = json.loads(load(PROCESSED / "validation.json", "run 03_harmonize.py").read_text(encoding="utf-8"))
    prep = json.loads(load(INTERIM / "prepare_report.json", "run 02_prepare.py").read_text(encoding="utf-8"))
    refuse_fixture_inputs(val, prep)
    avail = pd.read_csv(load(RAW / "availability.csv", "run 01_fetch.py")).set_index("data_id")
    for region in harm["region"].unique():
        for need, src in ((region in regions, "config/regions.json"), (region in val, "validation.json"),
                          (region in prep["regions"], "prepare_report.json")):
            if not need:
                raise SystemExit(f"Region {region!r} is missing from {src}.")
        if "size_classes" not in val[region] or "model_selection" not in val[region]:
            raise SystemExit(f"validation.json has no size_classes / model_selection for {region!r}: it was written by an older "
                             "03_harmonize.py. Run the current pipeline/03_harmonize.py first.")

    info = {}
    for region in sorted(harm["region"].unique()):
        months, fv, pf, prov, uniq, mat = build_matrix(region, harm[harm["region"] == region].reset_index(drop=True))
        info[region] = {"months": months, "fv": fv, "pf": pf, "prov": prov, "uniq": uniq, "mat": mat, "val": val[region]}

    for t in THRESHOLDS:
        payloads = {r: cells_payload(i["months"], i["fv"], i["pf"], i["uniq"], i["mat"], t) for r, i in info.items()}
        texts = {r: dumps(p[0]) for r, p in payloads.items()}
        size = sum(len(x.encode("utf-8")) for x in texts.values())
        if size <= TARGET_BYTES:
            break
    else:
        raise SystemExit(f"Cannot get under {TARGET_BYTES} bytes even with threshold {THRESHOLDS[-1]}.")
    print(f"threshold used: cells need total >= {t} detections (total cell json {size / 1e6:.2f} MB)")
    for r, (payload, keep, total) in payloads.items():
        dropped = ~keep
        print(f"{r}: {int(keep.sum())} cells kept, {int(dropped.sum())} dropped "
              f"({int(((total == 0) & dropped).sum())} with zero detections in all months, "
              f"{int(((total > 0) & dropped).sum())} below the threshold = "
              f"{100 * total[dropped].sum() / total.sum():.4f}% of the region's detections)")

    OUT.mkdir(parents=True, exist_ok=True)
    for r, text in texts.items():
        (OUT / f"cells_{r}.json").write_text(text, encoding="utf-8")
    (OUT / "regions.json").write_text(json.dumps(region_entries(regions, info), indent=2), encoding="utf-8")

    snpp_series_end = avail.loc["VIIRS_SNPP_SP", "max_date"]
    digest = hashlib.sha256((PROCESSED / "harmonized_cells.parquet").read_bytes()).hexdigest()[:8]
    meta = {
        "synthetic": False,  # refuse_fixture_inputs has already exited if any input was a fixture
        "dataVersion": f"{date.today():%Y-%m-%d}-{digest}", "generated": date.today().isoformat(),
        "methodsSummary": methods_summary(snpp_series_end),
        "snpp": {"lastDateUsedInSeries": snpp_series_end,
                 "lastNrtDateAvailable": avail.loc["VIIRS_SNPP_NRT", "max_date"],
                 "note": "Suomi NPP stopped delivering new data on 2026-11-02 (FIRMS FAQ); later months come from NOAA-20"},
        "sourceProducts": SOURCE_PRODUCTS,
        "filters": prep["filters"], "platformNote": prep["platform_note"],
        "staticMaskValidation": mask_validation(prep),
        "regions": {r: region_meta(r, val[r], prep) for r in info},
    }
    for r, i in info.items():
        meta["regions"][r]["rawVsHarmonized"] = raw_vs_harmonized(harm[harm["region"] == r], i["months"], i["fv"])
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    copy_figures(list(info))

    print("\nfile sizes:")
    total_bytes = 0
    for p in sorted(OUT.glob("*.json")):
        total_bytes += p.stat().st_size
        print(f"  {p.name}: {p.stat().st_size / 1e6:.3f} MB")
    print(f"  total: {total_bytes / 1e6:.2f} MB (target {TARGET_BYTES / 1e6:.0f} MB)")

    print("\nvalidation (reload cells json, sum per month vs harmonized_cells.parquet):")
    results = [validate(r, harm[harm["region"] == r], info[r]["months"], OUT / f"cells_{r}.json") for r in info]
    if not all(results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
