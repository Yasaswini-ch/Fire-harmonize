"""Clean raw FIRMS chunks and aggregate them to monthly 0.25 degree cells.

Reads  data/raw/{region}/{source_dir}/*.csv   (written by 01_fetch.py)
Writes data/interim/monthly_cells.parquet     region, sensor, platform, product, cell_lat, cell_lon,
                                              year, month, n_detections, n_day, n_night
       data/interim/region_monthly.parquet    same without cells: region-wide monthly totals
       data/interim/prepare_report.json       row counts after every filter, coverage, zero months
       data/interim/qa_{region}_raw_monthly.png

sensor is "modis" or "viirs"; product is the explicit source: modis_sp, viirs_snpp_sp,
viirs_noaa20_sp or viirs_noaa20_nrt (the raw folder name, lowercased).
Also writes data/interim/static_mask_{region}.parquet: locations (rounded to 0.005 degrees) of SP VIIRS
rows with type != 0. NRT rows have no type column, so detections at those locations are dropped from NRT.
Run:  python pipeline/02_prepare.py [--region western_na]
"""
import argparse
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from common import INTERIM, RAW, load_regions

# ---- filters and settings (change here) ------------------------------------------------------
KEEP_TYPE = 0  # presumed vegetation fire; 1 = active volcano, 2 = other static land source, 3 = offshore
TYPE_LABELS = {1: "volcano", 2: "static_source", 3: "offshore"}
MODIS_MIN_CONFIDENCE = 30  # MODIS confidence is 0-100; rows below this are dropped
VIIRS_DROP_CONFIDENCE = {"l"}  # VIIRS 375 m confidence is l / n / h (low / nominal / high)
MODIS_KEEP_PLATFORMS = {"aqua"}  # see PLATFORM_NOTE
CELL_DEG = 0.25
STATIC_ROUND_DEG = 0.005  # ~550 m; locations of SP type != 0 rows are matched to NRT rows at this resolution

# Platform choice. Checked on 2026-11-14 against the FIRMS FAQ
# (https://www.earthdata.nasa.gov/data/tools/firms/faq): "Aqua passes over the equator at
# approximately 1:30 p.m. and 1:30 a.m. MLT", Terra at approximately 10:30. The Suomi NPP crossing
# time could NOT be found on the NASA pages checked; 13:30 for S-NPP is general knowledge,
# unverified here. NASA's Aqua page (https://science.nasa.gov/mission/aqua/) says Aqua has been in
# drifting to later crossing times since 2021 (see PLATFORM_NOTE), so the match with S-NPP is
# weaker for recent years.
PLATFORM_NOTE = ("Aqua kept (NASA gives Aqua about 13:30 mean local time and Terra about 10:30; the VIIRS satellites fly a similar afternoon schedule). Aqua's overpass has been drifting later since 2021: its last orbit-maintenance maneuver was on 1 December 2021, and NASA's pages date the start of the drift between July 2021 and January 2022.")

USECOLS = {"latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "daynight", "type"}
PLATFORMS = ["aqua", "terra", "snpp", "noaa20", "noaa21"]
PLATFORM_MAP = {"aqua": "aqua", "a": "aqua", "terra": "terra", "t": "terra",
                "n": "snpp", "n20": "noaa20", "n21": "noaa21"}  # FIRMS attribute docs: N, N20, N21
VIIRS_CONF = {"l": 0, "n": 1, "h": 2}
PRODUCT_COLORS = {"modis_sp": "#E69F00", "viirs_snpp_sp": "#0072B2",
                  "viirs_noaa20_sp": "#009E73", "viirs_noaa20_nrt": "#CC79A7"}  # colour-blind safe


# ---- reading ---------------------------------------------------------------------------------

def parse_dir(name):
    """'MODIS_SP' -> ('modis', 'modis_sp'); 'VIIRS_NOAA20_nrt' -> ('viirs', 'viirs_noaa20_nrt')."""
    return ("modis" if name.upper().startswith("MODIS") else "viirs"), name.lower()


def loc_idx(lat, lon):
    """Integer grid indices at STATIC_ROUND_DEG; the rounded location is index * STATIC_ROUND_DEG."""
    return (np.rint(np.asarray(lat) / STATIC_ROUND_DEG).astype("int64"),
            np.rint(np.asarray(lon) / STATIC_ROUND_DEG).astype("int64"))


def key_from_idx(ilat, ilon):
    return (np.asarray(ilat) + 100_000) * 1_000_000 + (np.asarray(ilon) + 100_000)


def finalize_mask(region, parts, stats):
    """Write static_mask_{region}.parquet from the type != 0 locations of the SP VIIRS files; return its keys."""
    if parts:
        lat, lon = np.concatenate([p["lat"].values for p in parts]), np.concatenate([p["lon"].values for p in parts])
        ilat, ilon = loc_idx(lat, lon)
        mask = pd.DataFrame({"ilat": ilat, "ilon": ilon}).value_counts().rename("n_rows").reset_index()
    else:
        mask = pd.DataFrame({"ilat": pd.Series(dtype="int64"), "ilon": pd.Series(dtype="int64"),
                             "n_rows": pd.Series(dtype="int64")})
    mask["lat"] = (mask["ilat"] * STATIC_ROUND_DEG).round(3)
    mask["lon"] = (mask["ilon"] * STATIC_ROUND_DEG).round(3)
    mask.to_parquet(INTERIM / f"static_mask_{region}.parquet", index=False)
    stats["n_mask_locations"] = int(len(mask))
    return key_from_idx(mask["ilat"].values, mask["ilon"].values)


def read_chunk(path, sensor):
    """One raw CSV -> compact numeric frame. Fails loudly on unknown codes instead of guessing."""
    df = pd.read_csv(path, usecols=lambda c: c in USECOLS, dtype=str)
    missing = USECOLS - {"type"} - set(df.columns)
    if missing:
        raise SystemExit(f"{path} is missing columns {sorted(missing)}")
    plat = df["satellite"].str.strip().str.lower().map(PLATFORM_MAP)
    if plat.isna().any():
        raise SystemExit(f"{path}: unknown satellite values {sorted(df['satellite'][plat.isna()].unique())}")
    if sensor == "modis":
        conf = pd.to_numeric(df["confidence"], errors="raise").astype("int16")
    else:
        conf = df["confidence"].str.strip().str.lower().map(VIIRS_CONF)
        if conf.isna().any():
            raise SystemExit(f"{path}: unknown VIIRS confidence values {sorted(df['confidence'][conf.isna()].unique())}")
        conf = conf.astype("int16")
    return pd.DataFrame({
        "lat": df["latitude"].astype("float64"), "lon": df["longitude"].astype("float64"),
        "date": (df["acq_date"].str[:4] + df["acq_date"].str[5:7] + df["acq_date"].str[8:10]).astype("int32"),
        "time": df["acq_time"].astype("int16"),
        "platform": pd.Categorical(plat, categories=PLATFORMS),
        "conf": conf,
        "day": (df["daynight"] == "D").values,
        "type": pd.to_numeric(df["type"], errors="raise").astype("int8") if "type" in df else np.int8(-1),
    })


def read_source(src_dir, sensor):
    files = sorted(f for f in src_dir.glob("*.csv") if f.stat().st_size > 0)
    frames = [read_chunk(f, sensor) for f in files]
    frames = [f for f in frames if len(f)]
    if not frames:
        return pd.DataFrame(columns=["lat", "lon", "date", "time", "platform", "conf", "day", "type"]), len(files)
    return pd.concat(frames, ignore_index=True), len(files)


# ---- filters ---------------------------------------------------------------------------------

def apply_filters(df, sensor, has_type, mask_keys=None):
    """Return (filtered df, counts). Order: duplicates, type, static mask (NRT only), platform,
    confidence; counts are sequential."""
    c = {"raw_rows": len(df)}
    df = df.drop_duplicates(subset=["lat", "lon", "date", "time", "platform"])
    c["duplicates_removed"] = c["raw_rows"] - len(df)
    if has_type:
        dropped = df[df["type"] != KEEP_TYPE]["type"].value_counts()
        c["type_removed"] = {TYPE_LABELS.get(int(k), f"type_{k}"): int(v) for k, v in dropped.items()}
        df = df[df["type"] == KEEP_TYPE]
    else:
        c["type_removed"] = "type column absent (NRT does not attribute type): replaced by static mask"
    c["static_mask_removed"] = 0
    if mask_keys is not None:
        n = len(df)
        df = df[~np.isin(key_from_idx(*loc_idx(df["lat"].values, df["lon"].values)), mask_keys)]
        c["static_mask_removed"] = n - len(df)
    c["platform_counts_before_platform_filter"] = {k: int(v) for k, v in df["platform"].value_counts().items() if v}
    if sensor == "modis":
        n = len(df)
        df = df[df["platform"].isin(MODIS_KEEP_PLATFORMS)]
        c["platform_removed"] = n - len(df)
        n = len(df)
        df = df[df["conf"] >= MODIS_MIN_CONFIDENCE]
    else:
        c["platform_removed"] = 0
        n = len(df)
        df = df[~df["conf"].isin([VIIRS_CONF[k] for k in VIIRS_DROP_CONFIDENCE])]
    c["confidence_removed"] = n - len(df)
    c["final_rows"] = len(df)
    return df, c


# ---- aggregation -----------------------------------------------------------------------------

def aggregate(df, region, sensor, product):
    """Monthly counts per 0.25 degree cell. cell_lat/lon are cell centres: (index + 0.5) * 0.25 is
    exact in binary floating point, so the same cell always gets identical floats (03 matches on them)."""
    ix = np.floor(df["lon"].values / CELL_DEG).astype("int32")
    iy = np.floor(df["lat"].values / CELL_DEG).astype("int32")
    g = (df.assign(ix=ix, iy=iy, year=df["date"] // 10000, month=df["date"] // 100 % 100)
           .groupby(["platform", "ix", "iy", "year", "month"], observed=True)["day"]
           .agg(n_detections="size", n_day="sum").reset_index())
    g["n_night"] = g["n_detections"] - g["n_day"]
    g.insert(0, "region", region)
    g.insert(1, "sensor", sensor)
    g.insert(3, "product", product)
    g["platform"] = g["platform"].astype(str)
    g["cell_lat"] = (g["iy"] + 0.5) * CELL_DEG
    g["cell_lon"] = (g["ix"] + 0.5) * CELL_DEG
    cols = ["region", "sensor", "platform", "product", "cell_lat", "cell_lon", "year", "month",
            "n_detections", "n_day", "n_night"]
    return g[cols].astype({"year": "int16", "month": "int8", "n_detections": "int32",
                           "n_day": "int32", "n_night": "int32"})


def coverage(cells):
    """First/last month, cells with detections, and months inside that span with zero detections region-wide."""
    tot = cells.groupby(["year", "month"])["n_detections"].sum()
    if tot.empty:
        return {"first_month": None, "last_month": None, "n_cells": 0, "zero_months": []}
    first, last = min(tot.index), max(tot.index)
    span = pd.period_range(f"{first[0]}-{first[1]:02d}", f"{last[0]}-{last[1]:02d}", freq="M")
    present = {f"{y}-{m:02d}" for y, m in tot.index}
    return {"first_month": f"{first[0]}-{first[1]:02d}", "last_month": f"{last[0]}-{last[1]:02d}",
            "n_cells": int(cells[["cell_lat", "cell_lon"]].drop_duplicates().shape[0]),
            "zero_months": [str(p) for p in span if str(p) not in present]}


# ---- QA plot ---------------------------------------------------------------------------------

def qa_plot(region, rm, path):
    """Region monthly totals, MODIS (kept platforms) vs VIIRS. Missing months show as breaks in the line."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 4.5))
    for ax, log in zip(axes, (False, True)):
        for key, color in PRODUCT_COLORS.items():
            s = rm[rm["product"] == key].groupby("month_start")["n_detections"].sum()
            if s.empty:
                continue
            s = s.reindex(pd.date_range(s.index.min(), s.index.max(), freq="MS"))
            ax.plot(s.index, s.values, color=color, lw=1.3, label=key)
        ax.set(ylabel="detections per month", title=f"{region} raw monthly totals" + (" (log)" if log else ""))
        if log:
            ax.set_yscale("log")
        ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# ---- main ------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region")
    args = ap.parse_args()

    regions = load_regions()
    if args.region:
        if args.region not in regions:
            raise SystemExit(f"Unknown region {args.region!r}. Known: {', '.join(regions)}")
        regions = {args.region: regions[args.region]}
    todo = [r for r in regions if (RAW / r).is_dir()]
    if not todo:
        raise SystemExit(f"No raw data found under {RAW}. Run pipeline/01_fetch.py first.")
    INTERIM.mkdir(parents=True, exist_ok=True)
    print("Platform check:", PLATFORM_NOTE)

    filters = {"type_kept": KEEP_TYPE, "modis_min_confidence": MODIS_MIN_CONFIDENCE,
               "viirs_dropped_confidence": sorted(VIIRS_DROP_CONFIDENCE), "modis_platforms_kept": sorted(MODIS_KEEP_PLATFORMS),
               "cell_deg": CELL_DEG, "static_mask_round_deg": STATIC_ROUND_DEG}
    all_cells, report = [], {"platform_note": PLATFORM_NOTE, "filters": filters, "regions": {}}
    for region in todo:
        stats = {"sp_viirs_rows": 0, "sp_viirs_type_nonzero_rows": 0}
        report["regions"][region] = {"static_mask": stats}
        parts, mask_keys = [], None
        # SP VIIRS must be read before NRT: its type != 0 rows build the mask that NRT is filtered with.
        dirs = sorted((p for p in (RAW / region).iterdir() if p.is_dir()), key=lambda p: (p.name.lower().endswith("_nrt"), p.name))
        for src_dir in dirs:
            sensor, product = parse_dir(src_dir.name)
            is_nrt = product.endswith("_nrt")
            if is_nrt and mask_keys is None:
                mask_keys = finalize_mask(region, parts, stats)
                if not stats["n_mask_locations"]:
                    print(f"WARNING {region}: no SP VIIRS type != 0 rows found; static sources are NOT removed from NRT")
            df, n_files = read_source(src_dir, sensor)
            has_type = bool(len(df)) and (df["type"] >= 0).any()
            if sensor == "viirs" and not is_nrt and has_type:
                parts.append(df.loc[(df["type"] >= 0) & (df["type"] != KEEP_TYPE), ["lat", "lon"]])
                stats["sp_viirs_rows"] += len(df)
                stats["sp_viirs_type_nonzero_rows"] += len(parts[-1])
            df, counts = apply_filters(df, sensor, has_type, mask_keys if is_nrt else None)
            if is_nrt:
                before = counts["raw_rows"] - counts["duplicates_removed"]
                stats["nrt_rows_before_mask"] = before
                stats["nrt_rows_dropped_by_mask"] = counts["static_mask_removed"]
                stats["nrt_dropped_pct"] = round(100 * counts["static_mask_removed"] / before, 2) if before else None
            cells = aggregate(df, region, sensor, product) if len(df) else pd.DataFrame()
            entry = {"source_dir": src_dir.name, "chunk_files": n_files, **counts, **(coverage(cells) if len(cells) else coverage(pd.DataFrame(columns=["year", "month", "n_detections", "cell_lat", "cell_lon"])))}
            report["regions"][region][product] = entry
            print(f"\n{region} {product}: raw {counts['raw_rows']}, duplicates -{counts['duplicates_removed']}, "
                  f"type -{counts['type_removed']}, static mask -{counts['static_mask_removed']}, "
                  f"platform -{counts['platform_removed']}, confidence -{counts['confidence_removed']} "
                  f"-> {counts['final_rows']} rows, {entry['n_cells']} cells, "
                  f"{entry['first_month']} to {entry['last_month']}, zero months: {entry['zero_months']}")
            if len(cells):
                all_cells.append(cells)
        if mask_keys is None:
            finalize_mask(region, parts, stats)
        if stats["sp_viirs_rows"]:
            stats["sp_viirs_type_nonzero_pct"] = round(100 * stats["sp_viirs_type_nonzero_rows"] / stats["sp_viirs_rows"], 2)
        print(f"{region} static mask: {stats}")
    if not all_cells:
        raise SystemExit("No detections left after filtering.")

    cells = pd.concat(all_cells, ignore_index=True)
    cells.to_parquet(INTERIM / "monthly_cells.parquet", index=False)
    rm = (cells.groupby(["region", "sensor", "platform", "product", "year", "month"], as_index=False)
               [["n_detections", "n_day", "n_night"]].sum())
    rm.to_parquet(INTERIM / "region_monthly.parquet", index=False)
    val_path = INTERIM / "static_mask_validation.json"  # written by the one-off mask validation; kept across reruns
    if val_path.exists():
        report["static_mask_validation"] = json.loads(val_path.read_text(encoding="utf-8"))
    (INTERIM / "prepare_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    rm["month_start"] = pd.to_datetime(dict(year=rm["year"], month=rm["month"], day=1))
    for region in todo:
        r = rm[rm["region"] == region]
        qa_plot(region, r, INTERIM / f"qa_{region}_raw_monthly.png")
    print(f"\nwrote monthly_cells.parquet ({len(cells)} rows), region_monthly.parquet, prepare_report.json, qa_*.png in {INTERIM}")

    if "western_na" in todo:
        w = rm[(rm["region"] == "western_na") & (rm["year"] == 2019)]
        side = w.pivot_table(index="month", columns="product", values="n_detections", aggfunc="sum")
        print("\nwestern_na 2019 region-wide monthly totals (months with no data are absent):")
        print(side.to_string())


if __name__ == "__main__":
    main()
