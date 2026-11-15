"""Harmonize MODIS (Aqua) and VIIRS (S-NPP) monthly cell counts into one VIIRS-equivalent series.

ASSUMPTION (not verifiable from the data): the MODIS -> VIIRS relationship estimated on 2012 to
2021 is assumed to hold for 2002 to 2011. Every modis_estimated number rests on that. It is
fitted on 2012-2021 only because Aqua's overpass has been drifting later since 2021 (its crossing
time moves later), so the relationship is not assumed stable from 2022; drift_{region}.png shows
how the fitted model performs on 2022 onward (a diagnostic, nothing is tuned to it).

Assembly per cell-month: S-NPP where it exists, else NOAA-20 (SP, then NRT = provisional), else the
MODIS estimate before S-NPP starts. NOAA-20 is bridged to S-NPP over their overlap (see bridge()).

Input (written by 02_prepare.py): data/interim/monthly_cells.parquet, long format, one row per
cell-month-sensor that had at least one detection: region, sensor, platform, product, cell_lat,
cell_lon (cell centre, identical floats for the same cell), year, month, n_detections. Rows are
filtered to vegetation fires. to_sensor_keys() maps the product names to "modis_aqua",
"viirs_snpp", "viirs_noaa20_sp" and "viirs_noaa20_nrt". Missing rows mean "zero detections", but only while
that sensor was operating (see build_cube).

Run:  python pipeline/03_harmonize.py [--region western_na]
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from common import INTERIM, PROCESSED, load_regions

MODELS = ["A", "B", "C", "D"]  # ordered simplest first; used by choose_model
MODEL_NAMES = {"A": "ratio", "B": "log1p linear", "C": "log1p linear + month offset", "D": "ratio per calendar month"}
REQUIRED = {"region", "sensor", "platform", "product", "cell_lat", "cell_lon", "year", "month", "n_detections"}
FIT_START, FIT_END, DRIFT_START = 2012, 2021, 2022  # fit/CV window; Aqua's overpass drifts later from 2021 to 2022
BRIDGE_TOL = (0.9, 1.1)  # NOAA-20 / S-NPP median AOI ratio outside this -> NOAA-20 is rescaled
SENSORS = ("modis_aqua", "viirs_snpp", "viirs_noaa20_sp", "viirs_noaa20_nrt")
PRODUCT_KEYS = {"modis_sp": "modis_aqua", "viirs_snpp_sp": "viirs_snpp",
                "viirs_noaa20_sp": "viirs_noaa20_sp", "viirs_noaa20_nrt": "viirs_noaa20_nrt"}
N_RECTS, RECT_MIN_DEG, RECT_MAX_DEG, SEED = 200, 1.0, 5.0, 42
MAX_AOI_MEDIAN_APE, MAX_AOI_BIAS = 30.0, 15.0  # loud-warning thresholds, percent
MIN_MOY_SAMPLES = 30  # below this a month-of-year interval falls back to the all-months one
# AOI size classes by the longer side of the rectangle, in degrees; the last class includes its upper bound.
# "region" (the whole region as one AOI) is added separately.
SIZE_CLASSES = [("1-2", 1.0, 2.0), ("2-3", 2.0, 3.0), ("3-5", 3.0, 5.0)]
COVERAGE_TARGET = 80.0  # percent; the interval is a 10th to 90th percentile band
ZERO_PRED_PCT = 90  # when the model predicts 0 the range is 0 to this percentile of the actual counts seen in such months
RECENT_BRIDGE_MONTHS = 6  # the NOAA-20 / S-NPP ratio is also checked over this many latest overlap months
SELECTION_RULE = (f"Keep the candidate models whose AOI-level bias is within +/-{MAX_AOI_BIAS:g} percent, then choose the lowest "
                  "median AOI-level error among them. If none qualifies, choose the lowest absolute bias and warn.")
SELECTION_NOTE = ("This rule was set after seeing the first cross-validation results, in which the earlier rule (lowest error, "
                  "simpler model preferred within 5 percent) chose a model with a large bias. It was not fixed in advance, "
                  "so the reported errors are not those of a pre-registered choice.")
BLUE, ORANGE, GREY = "#0072B2", "#E69F00", "#666666"  # colour-blind safe


# ---------------------------------------------------------------- input

def to_sensor_keys(df):
    """Map 02's product names to the four series used here; unknown products are dropped.
    MODIS must be Aqua (02 already drops Terra; checked again here)."""
    df = df[(df["product"] != "modis_sp") | (df["platform"] == "aqua")]
    out = pd.DataFrame({"region": df["region"], "cell_lat": df["cell_lat"], "cell_lon": df["cell_lon"],
                        "month": pd.to_datetime(dict(year=df["year"], month=df["month"], day=1)),
                        "sensor": df["product"].map(PRODUCT_KEYS), "count": df["n_detections"]})
    return out.dropna(subset=["sensor"])


# ---------------------------------------------------------------- cell x month cube

def build_cube(rdf):
    """Return (months, cells, cube) with cube[sensor] = array (cells x months).

    Zero-fill rule: a cell-month is 0 only inside the sensor's active period, NaN outside it.
    Active period = first to last month with any detection in the region. For the two standard
    processing sensors the FIRST month is dropped because both started mid-month (VIIRS 375 m on
    2012-01-20, Aqua in July 2002), so that month is partial and would read as artificially low.
    This costs at most one month per sensor. NRT starts the day after SP ends by construction,
    so its first month is kept. The last SP month is assumed complete (SP ends at month end).
    The grid of cells is every cell with a detection in any sensor; all-zero cells add nothing
    to AOI sums.
    """
    cells = rdf[["cell_lat", "cell_lon"]].drop_duplicates().sort_values(["cell_lat", "cell_lon"])
    cells = cells.reset_index(drop=True)
    index = pd.MultiIndex.from_frame(cells)
    rows_ci = index.get_indexer(pd.MultiIndex.from_frame(rdf[["cell_lat", "cell_lon"]]))

    first = {}
    for s, g in rdf.groupby("sensor"):
        first[s] = g["month"].min() + pd.DateOffset(months=0 if s.endswith("_nrt") else 1)
    for need in ("modis_aqua", "viirs_snpp"):
        if need not in first:
            raise SystemExit(f"No {need} rows for region {rdf['region'].iloc[0]!r}.")
    start, end = first["modis_aqua"], rdf["month"].max()
    months = pd.date_range(start, end, freq="MS")
    mi = (rdf["month"].dt.year - start.year) * 12 + rdf["month"].dt.month - start.month

    cube = {}
    for s in SENSORS:
        arr = np.full((len(cells), len(months)), np.nan)
        if s in first:
            sel = (rdf["sensor"] == s).values
            lo = (first[s].year - start.year) * 12 + first[s].month - start.month
            hi = (rdf.loc[sel, "month"].max().year - start.year) * 12 + rdf.loc[sel, "month"].max().month - start.month
            arr[:, lo:hi + 1] = 0.0
            ok = sel & (mi.values >= lo) & (mi.values <= hi)
            np.add.at(arr, (rows_ci[ok], mi.values[ok]), rdf.loc[ok, "count"].values.astype(float))
        cube[s] = arr
    return months, cells, cube


def active(arr):
    """Boolean per month: was this sensor operating (zero-filled, not NaN)?"""
    return ~np.isnan(arr[0])


# ---------------------------------------------------------------- models

def fit(name, x, y, moy):
    """Fit one model on 2-D arrays x (MODIS) and y (VIIRS), cells x months; moy = month of year per column."""
    if name == "A":
        if x.sum() == 0:
            raise SystemExit("No MODIS detections in the training data; cannot fit the ratio model.")
        return {"r": float(y.sum() / x.sum())}
    if name == "D":
        # One ratio per calendar month, so a season where MODIS misses more of the small fires than usual
        # gets its own factor. A month with no MODIS detections falls back to the all-months ratio.
        overall = float(y.sum() / x.sum()) if x.sum() > 0 else 0.0
        ratios = []
        for month in range(1, 13):
            xs = x[:, moy == month].sum()
            ratios.append(float(y[:, moy == month].sum() / xs) if xs > 0 else overall)
        return {"ratios": ratios, "r": overall}
    lx, ly = np.log1p(x).ravel(), np.log1p(y).ravel()
    if name == "B":
        b, a = np.polyfit(lx, ly, 1)
        return {"a": float(a), "b": float(b)}
    # C: one intercept per calendar month (12 dummies, no shared intercept) plus a common slope.
    m = np.broadcast_to(moy, x.shape).ravel() - 1
    design = np.zeros((lx.size, 13))
    design[np.arange(lx.size), m] = 1.0
    design[:, 12] = lx
    coef = np.linalg.lstsq(design, ly, rcond=None)[0]
    return {"offsets": coef[:12].tolist(), "b": float(coef[12])}


def predict(name, p, x, moy):
    """Predict VIIRS counts. B and C back-transform with expm1, which is slightly biased low
    (the exp of an average of logs is not the average); the bias shows up in the AOI-level
    bias metric below rather than being corrected here."""
    if name == "A":
        return p["r"] * x
    if name == "D":
        return np.asarray(p["ratios"])[moy - 1] * x
    lx = np.log1p(x)
    z = p["a"] + p["b"] * lx if name == "B" else np.asarray(p["offsets"])[moy - 1] + p["b"] * lx
    return np.clip(np.expm1(z), 0, None)


def loyo_predictions(x, y, years, moy):
    """Leave-one-year-out: every overlap cell-month is predicted by models fitted on other years."""
    if len(np.unique(years)) < 2:
        raise SystemExit("Need at least 2 overlap years for leave-one-year-out cross-validation.")
    oof = {m: np.zeros_like(x) for m in MODELS}
    for yr in np.unique(years):
        test = years == yr
        for m in MODELS:
            params = fit(m, x[:, ~test], y[:, ~test], moy[~test])
            oof[m][:, test] = predict(m, params, x[:, test], moy[test])
    return oof


# ---------------------------------------------------------------- evaluation

def cell_metrics(y, p):
    ly, lp = np.log1p(y), np.log1p(p)
    return {"rmse": float(np.sqrt(np.mean((p - y) ** 2))), "mae": float(np.mean(np.abs(p - y))),
            "r2_log1p": float(1 - ((ly - lp) ** 2).sum() / ((ly - ly.mean()) ** 2).sum())}


def region_metrics(y, p):
    ty, tp = y.sum(0), p.sum(0)
    k = ty > 0
    return {"mape_pct": float(100 * np.mean(np.abs(tp[k] - ty[k]) / ty[k])),
            "bias_pct": float(100 * (tp[k].sum() - ty[k].sum()) / ty[k].sum())}


def random_aois(cells, bbox, rng):
    """N_RECTS random rectangles (1-5 degrees a side) inside the region, as boolean cell masks.
    Cells are matched by centre; rectangles are >= 1 degree so edge effects are small. Intervals
    derived from these therefore describe AOIs of 1 degree or more, not tiny AOIs.
    Returns [(mask, longer_side_degrees), ...]. The random draws are the same as they have always been."""
    w, s, e, n = bbox
    aois = []
    for _ in range(N_RECTS):
        dx = min(rng.uniform(RECT_MIN_DEG, RECT_MAX_DEG), e - w)
        dy = min(rng.uniform(RECT_MIN_DEG, RECT_MAX_DEG), n - s)
        x0, y0 = rng.uniform(w, e - dx), rng.uniform(s, n - dy)
        aois.append((((cells["cell_lon"] >= x0) & (cells["cell_lon"] <= x0 + dx)
                      & (cells["cell_lat"] >= y0) & (cells["cell_lat"] <= y0 + dy)).values, max(dx, dy)))
    return aois


def random_masks(cells, bbox, rng):
    """Just the boolean masks of random_aois."""
    return [m for m, _ in random_aois(cells, bbox, rng)]


def aoi_pairs(y, p, masks, moy):
    """Monthly actual (sy) and predicted (sp) totals for every rectangle, with calendar month."""
    sy, sp, mm = [], [], []
    for m in masks:
        if m.any():
            sy.append(y[m].sum(0)); sp.append(p[m].sum(0)); mm.append(moy)
    return np.concatenate(sy), np.concatenate(sp), np.concatenate(mm)


def aoi_metrics(sy, sp):
    """AOI-month pairs with actual == 0 are dropped (percent error undefined); the count is reported.
    Sparse off-season months inflate the median error, so this metric is deliberately harsh."""
    k = sy > 0
    return {"median_ape_pct": float(100 * np.median(np.abs(sp[k] - sy[k]) / sy[k])),
            "bias_pct": float(100 * (sp[k].sum() - sy[k].sum()) / sy[k].sum()),
            "n_aoi_months": int(k.sum())}


def select_model(aoi):
    """Returns (chosen, candidate_table, none_qualified). See SELECTION_RULE. Ties go to the simpler model."""
    table = [{"model": m, "name": MODEL_NAMES[m], "median_ape_pct": aoi[m]["median_ape_pct"], "bias_pct": aoi[m]["bias_pct"],
              "qualifies": abs(aoi[m]["bias_pct"]) <= MAX_AOI_BIAS} for m in MODELS]
    ok = [r for r in table if r["qualifies"]]
    if ok:
        best = min(ok, key=lambda r: (r["median_ape_pct"], MODELS.index(r["model"])))
    else:
        best = min(table, key=lambda r: abs(r["bias_pct"]))
    return best["model"], table, not ok


def choose_model(aoi):
    return select_model(aoi)[0]


# ---------------------------------------------------------------- error and interval by AOI size

def size_class_of(longer_side):
    for cid, _, hi in SIZE_CLASSES:
        if longer_side < hi:
            return cid
    return SIZE_CLASSES[-1][0]


def pairs_for(y, p, masks, moy, years):
    """Monthly actual and predicted totals for every AOI, with calendar month and year, as flat arrays."""
    cols = [[], [], [], []]
    for m in masks:
        if m.any():
            for c, v in zip(cols, (y[m].sum(0), p[m].sum(0), moy, years)):
                c.append(v)
    if not cols[0]:
        return tuple(np.array([]) for _ in cols)
    return tuple(np.concatenate(c) for c in cols)


def error_stats(sy, sp):
    """Median absolute percent error and bias use only months with a non-zero actual count (percent error is
    undefined at 0). The count-weighted error is the sum of absolute errors over the sum of actual counts over ALL
    months, so it is not driven by tiny counts; with the median actual count it shows how much of the median
    percent error is small-count noise. Both error metrics are reported."""
    nz = sy > 0
    if not nz.any():
        return None
    err = np.abs(sp - sy)
    return {"median_ape_pct": float(100 * np.median(err[nz] / sy[nz])),
            "bias_pct": float(100 * (sp[nz].sum() - sy[nz].sum()) / sy[nz].sum()),
            "count_weighted_error_pct": float(100 * err.sum() / sy.sum()),
            "median_actual_count_nonzero": float(np.median(sy[nz])), "median_actual_count_all": float(np.median(sy)),
            "n_pairs": int(len(sy)), "n_nonzero": int(nz.sum())}


def zero_pred_hi(sy, sp):
    """Upper end of the range for a month where the model predicts 0 detections: a multiple of 0 is 0, so such a month
    needs its own bound. It is the ZERO_PRED_PCT percentile of the actual counts in the months the model predicted 0."""
    z = sp == 0
    return float(np.percentile(sy[z], ZERO_PRED_PCT)) if z.any() else 0.0


def interval_coverage(sy, sp, mm, yy, per_month):
    """Share of AOI-months whose actual count falls inside the stated range: [lo*predicted, hi*predicted] where the
    prediction is above 0, and [0, zero_pred_hi] where it is 0. Months where both the actual and the predicted count
    are 0 are left out (trivially inside). Reported:
      in_sample              multipliers fitted on the same pairs, so near the target by construction
      held_out_years         multipliers fitted on the other years, checked on each held-out year (the honest one)
      held_out_years_predicted_positive   the same, only for months where the model predicted more than 0
      zero_pred_share_pct    share of months with detections in which the model predicted 0"""
    keep = (sy > 0) | (sp > 0)
    empty = {"in_sample_pct": None, "held_out_years_pct": None, "held_out_years_pct_predicted_positive": None,
             "zero_pred_share_pct": None, "n": 0, "target_pct": COVERAGE_TARGET}
    if not keep.any() or not (sp > 0).any():
        return empty

    def inside(lo, hi, zhi, a, b, m):
        return np.where(b > 0, (a >= lo[m - 1] * b) & (a <= hi[m - 1] * b), a <= zhi)

    lo, hi = multipliers(sy, sp, mm, per_month)
    in_sample = float(100 * inside(lo, hi, zero_pred_hi(sy, sp), sy[keep], sp[keep], mm[keep]).mean())
    hits = total = hits_pos = total_pos = 0
    for yr in np.unique(yy):
        train, test = yy != yr, (yy == yr) & keep
        if not test.any() or not (sp[train] > 0).any():
            continue
        lo2, hi2 = multipliers(sy[train], sp[train], mm[train], per_month)
        ok = inside(lo2, hi2, zero_pred_hi(sy[train], sp[train]), sy[test], sp[test], mm[test])
        hits += int(ok.sum())
        total += int(test.sum())
        pos = sp[test] > 0
        hits_pos += int(ok[pos].sum())
        total_pos += int(pos.sum())
    nz = sy > 0
    return {"in_sample_pct": in_sample, "held_out_years_pct": float(100 * hits / total) if total else None,
            "held_out_years_pct_predicted_positive": float(100 * hits_pos / total_pos) if total_pos else None,
            "zero_pred_share_pct": float(100 * ((sp == 0) & nz).sum() / nz.sum()), "n": int(keep.sum()),
            "target_pct": COVERAGE_TARGET}


def size_class_row(cid, label, min_deg, max_deg, n_aois, pairs, per_month, fallback):
    sy, sp, mm, yy = pairs
    row = {"id": cid, "label": label, "min_deg": min_deg, "max_deg": max_deg, "n_aois": n_aois}
    stats = error_stats(sy, sp) if len(sy) else None
    if stats is None or not (sp > 0).any():
        # nothing to measure for this class: say so, and use the pooled multipliers rather than inventing any
        return {**row, "median_ape_pct": None, "bias_pct": None, "count_weighted_error_pct": None, "n_pairs": 0,
                "median_actual_count_nonzero": None, "median_actual_count_all": None, "n_nonzero": 0,
                "lo_mult_by_month": fallback[0].round(4).tolist(), "hi_mult_by_month": fallback[1].round(4).tolist(),
                "multipliers_are_pooled_fallback": True, "zero_pred_hi_count": 0.0,
                "coverage": {"in_sample_pct": None, "held_out_years_pct": None, "held_out_years_pct_predicted_positive": None,
                             "zero_pred_share_pct": None, "n": 0, "target_pct": COVERAGE_TARGET}}
    lo, hi = multipliers(sy, sp, mm, per_month)
    return {**row, **stats, "lo_mult_by_month": lo.round(4).tolist(), "hi_mult_by_month": hi.round(4).tolist(),
            "multipliers_are_pooled_fallback": False, "zero_pred_hi_count": round(zero_pred_hi(sy, sp), 2),
            "coverage": interval_coverage(sy, sp, mm, yy, per_month)}


def size_class_table(y, p, aois, moy, years, per_month, bbox, fallback):
    """One row per size class plus the whole region as a single AOI, all from the same random AOIs and out-of-fold
    predictions as the headline numbers."""
    rows = []
    for cid, lo_deg, hi_deg in SIZE_CLASSES:
        masks = [m for m, side in aois if size_class_of(side) == cid]
        rows.append(size_class_row(cid, f"{lo_deg:g} to {hi_deg:g} degrees", lo_deg, hi_deg, len(masks),
                                   pairs_for(y, p, masks, moy, years), per_month, fallback))
    w, s, e, n = bbox
    side = float(max(e - w, n - s))
    rows.append(size_class_row("region", "whole region", side, side, 1, (y.sum(0), p.sum(0), moy, years), per_month, fallback))
    return rows


def multipliers(sy, sp, moy, per_month):
    """Empirical 10th/90th percentile of actual/predicted over cross-validated AOI-months.
    This is an empirical prediction interval from held-out residuals, NOT a formal confidence
    interval: it assumes future errors resemble past ones and that 2002-2011 behaves like 2012+.
    The multipliers are applied to cell values; because they are constant per region and month,
    summed cell intervals equal the interval of the sum."""
    ok = sp > 0
    ratio, m = sy[ok] / sp[ok], moy[ok]
    lo = np.full(12, np.percentile(ratio, 10))
    hi = np.full(12, np.percentile(ratio, 90))
    if per_month:
        for k in range(1, 13):
            if (m == k).sum() >= MIN_MOY_SAMPLES:
                lo[k - 1], hi[k - 1] = np.percentile(ratio[m == k], [10, 90])
    return lo, hi


# ---------------------------------------------------------------- harmonized table

def harmonize_table(region, months, cells, cube, model, params, lo_m, hi_m, n20_scale=1.0):
    """S-NPP > NOAA-20 SP > NOAA-20 NRT (provisional) > MODIS estimate. Cell-months with no active
    sensor are omitted. The MODIS estimate is only used BEFORE S-NPP starts: the fitted relationship
    is not valid after 2021 (Aqua drift), so it is never extrapolated into later gaps."""
    mod, snpp = cube["modis_aqua"], cube["viirs_snpp"]
    n20sp, n20nrt = cube["viirs_noaa20_sp"], cube["viirs_noaa20_nrt"]
    moy = months.month.values
    est = predict(model, params, np.nan_to_num(mod), moy)
    use_s = ~np.isnan(snpp)
    use_n = ~np.isnan(n20sp) & ~use_s
    use_p = ~np.isnan(n20nrt) & ~use_s & ~use_n
    pre = months < months[active(snpp)][0]
    estimated = ~np.isnan(mod) & pre[None, :] & ~use_s & ~use_n & ~use_p
    harm = np.where(use_s, snpp, np.where(use_n, n20sp * n20_scale, np.where(use_p, n20nrt * n20_scale, est)))
    sat = np.where(use_s, "snpp", np.where(use_n | use_p, "noaa20", "aqua"))
    ci, mi = np.nonzero(use_s | use_n | use_p | estimated)
    h, is_est = harm[ci, mi], estimated[ci, mi]
    return pd.DataFrame({
        "region": region,
        "cell_lat": cells["cell_lat"].values[ci], "cell_lon": cells["cell_lon"].values[ci],
        "month": months.values[mi],
        "harmonized": h,
        "lo": np.where(is_est, h * lo_m[moy[mi] - 1], h),
        "hi": np.where(is_est, h * hi_m[moy[mi] - 1], h),
        "source": np.where(is_est, "modis_estimated", "viirs_native"),
        "satellite": sat[ci, mi],
        "provisional": use_p[ci, mi],
        "modis_count": mod[ci, mi],
        "viirs_count": np.where(use_s, snpp, np.where(use_n, n20sp, n20nrt))[ci, mi],  # raw, unscaled
    })


# ---------------------------------------------------------------- bridge + drift

def bridge(snpp, n20, months, masks):
    """NOAA-20 / S-NPP over months where both standard-processing series exist: monthly region-level
    ratio and the median AOI-level ratio (same random AOIs as the CV). Both are ~13:30 sensors but
    different instruments, so a systematic offset is possible and is measured, not assumed away."""
    both = active(snpp) & active(n20)
    if not both.any():
        return None
    a, b = snpp[:, both], n20[:, both]
    ta, tb = a.sum(0), b.sum(0)
    k = ta > 0
    sy, sn, _ = aoi_pairs(a, b, masks, months[both].month.values)
    k2 = sy > 0
    return {"overlap": [f"{months[both][0]:%Y-%m}", f"{months[both][-1]:%Y-%m}"], "n_months": int(both.sum()),
            "region_monthly_ratio": {f"{m:%Y-%m}": round(float(r), 4) for m, r in zip(months[both][k], tb[k] / ta[k])},
            "region_ratio_median": float(np.median(tb[k] / ta[k])),
            "aoi_median_ratio": float(np.median(sn[k2] / sy[k2])), "n_aoi_months": int(k2.sum()),
            **recent_bridge(months[both][k], tb[k] / ta[k])}


def recent_bridge(month_idx, ratios):
    """The whole-overlap median can hide a recent drift (a satellite near the end of its life, say). Median of the
    latest RECENT_BRIDGE_MONTHS monthly region ratios, and whether it is outside BRIDGE_TOL. Reported, never rescaled."""
    last = ratios[-RECENT_BRIDGE_MONTHS:]
    if len(last) == 0:
        return {"recent_months": None, "recent_ratio_median": None, "recent_outside_tolerance": False}
    med = float(np.median(last))
    return {"recent_months": [f"{month_idx[-len(last)]:%Y-%m}", f"{month_idx[-1]:%Y-%m}"], "recent_ratio_median": med,
            "recent_outside_tolerance": not BRIDGE_TOL[0] <= med <= BRIDGE_TOL[1]}


def per_year_aoi(y, p, masks, moy, years):
    """AOI-level error metrics per calendar year (years with no AOI-month actual > 0 are skipped)."""
    out = {}
    for yr in np.unique(years):
        c = years == yr
        sy, sp, _ = aoi_pairs(y[:, c], p[:, c], masks, moy[c])
        if (sy > 0).any():
            out[int(yr)] = aoi_metrics(sy, sp)
    return out


def plot_drift(region, path, cv, post):
    """AOI error by year: held-out CV years (band = their min-max) and the fitted model applied to 2022+."""
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    for ax, key, label in ((axes[0], "median_ape_pct", "AOI median absolute % error"),
                           (axes[1], "bias_pct", "AOI bias %")):
        vals = [v[key] for v in cv.values()]
        ax.axhspan(min(vals), max(vals), color=GREY, alpha=0.25, label=f"{FIT_START}-{FIT_END} CV range")
        ax.plot(list(cv), vals, "o-", color=BLUE, label="held-out CV year")
        if post:
            ax.plot(list(post), [v[key] for v in post.values()], "s-", color=ORANGE,
                    label=f"model fitted {FIT_START}-{FIT_END}, applied {DRIFT_START}+")
        if key == "bias_pct":
            ax.axhline(0, color="black", lw=0.8)
        ax.set(xlabel="year", ylabel=label, title=f"{region}: MODIS->VIIRS error by year")
        ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# ---------------------------------------------------------------- validation + plot

def top_lists(table):
    by_month = table.groupby("month").agg(total=("harmonized", "sum"), source=("source", "first"),
                                          provisional=("provisional", "first"))
    by_year = table.groupby(table["month"].dt.year).agg(total=("harmonized", "sum"),
                                                        n_months=("month", "nunique"))
    top_m = by_month.nlargest(5, "total").reset_index()
    top_m["month"] = top_m["month"].dt.strftime("%Y-%m")
    return top_m.round(1).to_dict("records"), by_year.nlargest(5, "total").reset_index().round(1).to_dict("records")


def continuity(months_ov, y, p):
    """Out-of-sample MODIS estimate vs VIIRS native, region totals, 2012-2013, mean percent difference."""
    sel = np.isin(months_ov.year, [2012, 2013])
    ty, tp = y[:, sel].sum(0), p[:, sel].sum(0)
    k = ty > 0
    return float(100 * np.mean((tp[k] - ty[k]) / ty[k]))


def plot(region, path, table, pairs, region_pairs):
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(14, 5))
    sy, sp = pairs
    keep = (sy > 0) & (sp > 0)
    step = max(1, keep.sum() // 4000)
    a1.scatter(sp[keep][::step], sy[keep][::step], s=6, alpha=0.3, color=GREY, label="AOI-months (random rectangles)")
    ry, rp = region_pairs
    k = (ry > 0) & (rp > 0)
    a1.scatter(rp[k], ry[k], s=22, color=BLUE, label="region months")
    lim = [min(sp[keep].min(), sy[keep].min()), max(sp[keep].max(), sy[keep].max())]
    a1.plot(lim, lim, color="black", lw=1, label="1:1")
    a1.set(xscale="log", yscale="log", xlabel="predicted VIIRS-equivalent (held-out year)",
           ylabel="observed VIIRS", title=f"{region}: leave-one-year-out")
    a1.legend()
    g = table.groupby("month").agg(h=("harmonized", "sum"), lo=("lo", "sum"), hi=("hi", "sum"),
                                   src=("source", "first"), prov=("provisional", "first"))
    a2.fill_between(g.index, g["lo"], g["hi"], color=ORANGE, alpha=0.3, label="empirical 10-90% interval")
    for mask, color, label in ((g["src"] == "modis_estimated", ORANGE, "MODIS estimated"),
                               ((g["src"] == "viirs_native") & ~g["prov"], BLUE, "VIIRS native"),
                               (g["prov"], "#CC79A7", "VIIRS NRT (provisional)")):
        a2.plot(g.index, g["h"].where(mask), color=color, lw=1.5, label=label)
    a2.set(ylabel="monthly detections (VIIRS-equivalent)", title=f"{region}: harmonized region total")
    a2.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# ---------------------------------------------------------------- per region driver

def process_region(region, bbox, rdf, outdir):
    months, cells, cube = build_cube(rdf)
    both = active(cube["modis_aqua"]) & active(cube["viirs_snpp"])
    ov = both & (months.year >= FIT_START) & (months.year <= FIT_END)  # fit + CV window only
    if ov.sum() == 0:
        raise SystemExit(f"{region}: no {FIT_START}-{FIT_END} months where Aqua MODIS and S-NPP VIIRS both operate.")
    months_ov = months[ov]
    x, y = cube["modis_aqua"][:, ov], cube["viirs_snpp"][:, ov]
    moy, years = months_ov.month.values, months_ov.year.values
    print(f"\n=== {region}: {len(cells)} cells, fit window {months_ov[0]:%Y-%m} to {months_ov[-1]:%Y-%m} "
          f"({ov.sum()} months, {len(np.unique(years))} CV folds)")

    oof = loyo_predictions(x, y, years, moy)
    aois = random_aois(cells, bbox, np.random.default_rng(SEED))
    masks = [m for m, _ in aois]
    cell, reg, aoi, pairs = {}, {}, {}, {}
    for m in MODELS:
        cell[m], reg[m] = cell_metrics(y, oof[m]), region_metrics(y, oof[m])
        pairs[m] = aoi_pairs(y, oof[m], masks, moy)
        aoi[m] = aoi_metrics(pairs[m][0], pairs[m][1])
    table_cmp = pd.DataFrame({
        "model": [f"{m} {MODEL_NAMES[m]}" for m in MODELS],
        "cell_RMSE": [cell[m]["rmse"] for m in MODELS], "cell_MAE": [cell[m]["mae"] for m in MODELS],
        "cell_R2log": [cell[m]["r2_log1p"] for m in MODELS],
        "reg_MAPE%": [reg[m]["mape_pct"] for m in MODELS], "reg_bias%": [reg[m]["bias_pct"] for m in MODELS],
        "AOI_medAPE%": [aoi[m]["median_ape_pct"] for m in MODELS], "AOI_bias%": [aoi[m]["bias_pct"] for m in MODELS],
    })
    print(table_cmp.round(2).to_string(index=False))

    best, candidates, none_qualified = select_model(aoi)
    print(f"chosen model: {best} ({MODEL_NAMES[best]}); AOI-month pairs used: {aoi[best]['n_aoi_months']}")
    params = fit(best, x, y, moy)  # final fit on all overlap data
    per_month = best in ("C", "D")
    lo_m, hi_m = multipliers(*pairs[best], per_month=per_month)
    size_rows = size_class_table(y, oof[best], aois, moy, years, per_month, bbox, (lo_m, hi_m))
    print(f"\nError and interval by AOI size, chosen model {best} (same random AOIs; median % error uses non-zero months only,"
          f" count-weighted = sum |error| / sum actual):")
    print(f"{'size (deg)':<16}{'AOIs':>5}{'med err%':>10}{'bias%':>8}{'cnt-wtd%':>10}{'med count':>11}{'pred 0%':>9}{'cover%':>8}{'cover|pred>0':>14}")
    fmt = lambda v, nd=1: "n/a" if v is None else f"{v:.{nd}f}"
    for r in size_rows:
        print(f"{r['label']:<16}{r['n_aois']:>5}{fmt(r['median_ape_pct']):>10}{fmt(r['bias_pct']):>8}"
              f"{fmt(r['count_weighted_error_pct']):>10}{fmt(r['median_actual_count_nonzero'], 0):>11}"
              f"{fmt(r['coverage']['zero_pred_share_pct']):>9}{fmt(r['coverage']['held_out_years_pct']):>8}"
              f"{fmt(r['coverage']['held_out_years_pct_predicted_positive']):>14}")
    print(f"(held-out coverage; target {COVERAGE_TARGET:g}%. 'pred 0%' = share of months with detections that the model predicted as 0,"
          f" which get a range of 0 to the {ZERO_PRED_PCT}th percentile of such months)")

    # Drift diagnostic: the 2012-2021 model applied to MODIS months from 2022 on. Reporting only;
    # nothing (model choice, intervals) is tuned to it.
    dr = both & (months.year >= DRIFT_START)
    cv_year = per_year_aoi(y, oof[best], masks, moy, years)
    post_year = {}
    if dr.any():
        md = months[dr]
        pd_ = predict(best, params, cube["modis_aqua"][:, dr], md.month.values)
        post_year = per_year_aoi(cube["viirs_snpp"][:, dr], pd_, masks, md.month.values, md.year.values)
    plot_drift(region, outdir / f"drift_{region}.png", cv_year, post_year)
    print("AOI median APE by year, CV:", {k: round(v["median_ape_pct"], 1) for k, v in cv_year.items()})
    print(f"AOI median APE by year, {DRIFT_START}+ (fitted model, not held out):",
          {k: round(v["median_ape_pct"], 1) for k, v in post_year.items()} or "no MODIS+S-NPP months")

    # Bridge NOAA-20 to S-NPP; rescale NOAA-20 only if the median AOI ratio is outside BRIDGE_TOL.
    br = bridge(cube["viirs_snpp"], cube["viirs_noaa20_sp"], months, masks)
    n20_scale = 1.0
    if br is None:
        print("bridge: no S-NPP / NOAA-20 SP overlap; NOAA-20 used as is, ratio unknown")
    else:
        r = br["aoi_median_ratio"]
        print(f"bridge NOAA-20 / S-NPP: AOI median ratio {r:.3f}, region monthly median {br['region_ratio_median']:.3f}")
        if not BRIDGE_TOL[0] <= r <= BRIDGE_TOL[1]:
            n20_scale = 1.0 / r
            print("!" * 78 + f"\n!!! {region}: NOAA-20 / S-NPP ratio {r:.3f} is outside {BRIDGE_TOL}: ALL NOAA-20 months"
                  f"\n!!! (SP and NRT) are DIVIDED by {r:.3f} (x{n20_scale:.3f}) to match S-NPP.\n" + "!" * 78)
        br["scale_applied"] = n20_scale

    table = harmonize_table(region, months, cells, cube, best, params, lo_m, hi_m, n20_scale)
    top_m, top_y = top_lists(table)
    cont = continuity(months_ov, y, oof[best])
    print(f"continuity 2012-2013 (out-of-sample MODIS estimate vs VIIRS native): mean diff {cont:+.1f}%")
    print("largest months:", [(r["month"], r["total"]) for r in top_m])
    print("largest years (n_months shown; partial years undercount):", [(r["month"], r["total"], r["n_months"]) for r in top_y])

    warnings = []
    if br is not None and br.get("recent_outside_tolerance"):
        warnings.append(f"NOAA-20 / S-NPP ratio over the latest {RECENT_BRIDGE_MONTHS} overlap months ({br['recent_months'][0]} to "
                        f"{br['recent_months'][1]}) is {br['recent_ratio_median']:.2f}, outside {BRIDGE_TOL[0]} to {BRIDGE_TOL[1]}: "
                        "recent S-NPP months may undercount, so the S-NPP to NOAA-20 handover may add a step")
    if none_qualified:
        warnings.append(f"NO candidate model has AOI bias within +/-{MAX_AOI_BIAS:.0f}%; chose the lowest absolute bias ({best})")
        print("\n" + "!" * 78 + f"\n!!! {region}: NO MODEL MEETS THE BIAS LIMIT (+/-{MAX_AOI_BIAS:g}%). Chose {best}, the one with the"
              "\n!!! lowest absolute bias. Every estimated number for this region is biased. Do not rely on them."
              "\n" + "!" * 78)
    if aoi[best]["median_ape_pct"] > MAX_AOI_MEDIAN_APE:
        warnings.append(f"AOI median error {aoi[best]['median_ape_pct']:.1f}% > {MAX_AOI_MEDIAN_APE:.0f}%")
    if abs(aoi[best]["bias_pct"]) > MAX_AOI_BIAS:
        warnings.append(f"AOI bias {aoi[best]['bias_pct']:+.1f}% outside +/-{MAX_AOI_BIAS:.0f}%")
    if warnings:
        print("\n" + "!" * 78 + f"\n!!! WARNING {region}: HARMONIZATION IS POOR: " + "; ".join(warnings)
              + "\n!!! Do not present modis_estimated values as reliable. Next steps to try: bin cells by land"
              "\n!!! cover (savanna vs forest), use coarser cells, fit day and night detections separately."
              "\n" + "!" * 78)

    ty_reg = (y.sum(0), oof[best].sum(0))
    plot(region, outdir / f"validation_{region}.png", table, (pairs[best][0], pairs[best][1]), ty_reg)
    report = {
        "fit_window": [f"{months_ov[0]:%Y-%m}", f"{months_ov[-1]:%Y-%m}"], "n_cv_folds": int(len(np.unique(years))),
        "n_cells": int(len(cells)),
        "drift": {"cv_by_year": cv_year, "fitted_model_on_drift_years": post_year,
                  "note": "diagnostic only: Aqua's overpass has drifted later since 2021 to 2022; nothing is tuned to this"},
        "bridge_noaa20_vs_snpp": br,
        "models": {m: {"cell": cell[m], "region": reg[m], "aoi": aoi[m]} for m in MODELS},
        "chosen_model": best, "params": params,
        "model_selection": {"rule": SELECTION_RULE, "max_abs_bias_pct": MAX_AOI_BIAS, "candidates": candidates,
                            "chosen": best, "none_qualified": none_qualified, "note": SELECTION_NOTE},
        "size_classes": size_rows, "coverage_target_pct": COVERAGE_TARGET,
        "lo_mult_by_month": lo_m.round(4).tolist(), "hi_mult_by_month": hi_m.round(4).tolist(),
        "interval_note": "empirical 10-90 percentile of actual/predicted over cross-validated AOI-months "
                         f"({N_RECTS} rectangles of {RECT_MIN_DEG:g}-{RECT_MAX_DEG:g} deg); not a formal confidence interval",
        "continuity_2012_2013_mean_pct_diff": cont,
        "largest_months": top_m, "largest_years": top_y, "warnings": warnings,
        "assumption": "MODIS->VIIRS relationship fitted on 2012-2021 assumed to hold for 2002-2011",
    }
    return table, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region")
    ap.add_argument("--input", type=Path, default=INTERIM / "monthly_cells.parquet")
    ap.add_argument("--outdir", type=Path, default=PROCESSED)
    args = ap.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Missing {args.input}. Run pipeline/02_prepare.py first.")
    df = pd.read_parquet(args.input)
    if not REQUIRED <= set(df.columns):
        raise SystemExit(f"{args.input} is missing columns {sorted(REQUIRED - set(df.columns))}")
    df = to_sensor_keys(df)
    regions = load_regions()
    wanted = [args.region] if args.region else [r for r in regions if r in set(df["region"])]
    if not wanted:
        raise SystemExit("No configured region found in the input data.")
    args.outdir.mkdir(parents=True, exist_ok=True)

    tables, reports = [], {}
    for region in wanted:
        if region not in regions:
            raise SystemExit(f"Unknown region {region!r}. Known: {', '.join(regions)}")
        table, reports[region] = process_region(region, regions[region]["bbox"], df[df["region"] == region], args.outdir)
        tables.append(table)
    out = pd.concat(tables, ignore_index=True)
    out.to_parquet(args.outdir / "harmonized_cells.parquet", index=False)
    (args.outdir / "validation.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
    print(f"\nwrote {args.outdir / 'harmonized_cells.parquet'} ({len(out)} rows), validation.json, validation_*.png")


if __name__ == "__main__":
    main()
