"""How well does the static-source location mask work? Measured, not assumed.

Near-real-time (NRT) rows have no `type` column, so 02_prepare.py removes static sources (gas flares, industry, volcanoes,
offshore platforms) from them with a location mask built from standard-processing (SP) VIIRS rows whose type is not 0. This script
tests that idea where the answer is known:

  mask  = Suomi NPP SP rows 2012-2018 with type != 0, matched at 0.005 degrees (the same rule as 02_prepare.py)
  test  = NOAA-20 SP rows 2019-2025, treated as if they had no type column; the true type is then used to score the mask

Reported per region, for the exact 0.005 degree match and for a 3x3 neighbourhood:
  recall            share of static rows (type != 0) the mask removes
  false-drop        share of real vegetation fires (type 0) the mask removes by mistake
  net monthly bias  after the mask, how far the count of kept, not-low-confidence rows is from the true count of such rows

It reads the yearly country files (country_*.csv) written by 01b_fetch_country.py, which do not overlap, so no de-duplication is
needed. Run (PowerShell):   python pipeline/05_validate_mask.py [--region zambia]
Writes data/processed/mask_validation.json.
"""
import argparse
import json

import numpy as np
import pandas as pd

from common import PROCESSED, RAW, load_regions

ROUND_DEG = 0.005  # must match STATIC_ROUND_DEG in 02_prepare.py
MASK_YEARS = (2012, 2018)
TEST_YEARS = (2019, 2025)
USECOLS = ["latitude", "longitude", "acq_date", "confidence", "type"]


def keys(lat, lon):
    """Same integer key as 02_prepare.key_from_idx at ROUND_DEG."""
    ilat = np.rint(np.asarray(lat, dtype="float64") / ROUND_DEG).astype("int64")
    ilon = np.rint(np.asarray(lon, dtype="float64") / ROUND_DEG).astype("int64")
    return (ilat + 100_000) * 1_000_000 + (ilon + 100_000)


def neighbourhood(mask_keys):
    """The mask plus the eight adjacent bins around every masked location."""
    out = [mask_keys]
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di or dj:
                out.append(mask_keys + di * 1_000_000 + dj)
    return np.unique(np.concatenate(out))


def read_year_files(region, source_dir, years):
    """Yield one DataFrame per yearly country file inside the year range."""
    folder = RAW / region / source_dir
    for path in sorted(folder.glob("country_*.csv")):
        year = int(path.name.split("_")[1])
        if years[0] <= year <= years[1]:
            df = pd.read_csv(path, usecols=lambda c: c in USECOLS, dtype=str)
            if len(df):
                yield df


def build_mask(region):
    parts, source_rows, static_rows = [], 0, 0
    for df in read_year_files(region, "VIIRS_SNPP_SP", MASK_YEARS):
        typ = pd.to_numeric(df["type"], errors="raise").astype("int8")
        source_rows += len(df)
        static = typ.values != 0
        static_rows += int(static.sum())
        parts.append(np.unique(keys(df["latitude"].values[static], df["longitude"].values[static])))
    mask = np.unique(np.concatenate(parts)) if parts else np.array([], dtype="int64")
    return mask, source_rows, static_rows


def score(df, mask, mask3):
    """Counts for one test file. Pure given the arrays, so it can be tested. Returns a dict of integer counts."""
    typ = pd.to_numeric(df["type"], errors="raise").astype("int8").values
    low = (df["confidence"].str.strip().str.lower() == "l").values
    k = keys(df["latitude"].values, df["longitude"].values)
    month = df["acq_date"].str[:7].values
    out = {"rows": len(df), "static": int((typ != 0).sum()), "veg": int((typ == 0).sum()), "by_type": {}, "monthly": {}}
    for name, m in (("exact", mask), ("neighbourhood_3x3", mask3)):
        hit = np.isin(k, m)
        out[name] = {"static_removed": int((hit & (typ != 0)).sum()), "veg_removed": int((hit & (typ == 0)).sum()),
                     "removed_by_type": {int(t): int((hit & (typ == t)).sum()) for t in np.unique(typ) if t != 0}}
        out[name]["kept_not_low"] = {}
        for mo in np.unique(month):
            sel = month == mo
            out[name]["kept_not_low"][mo] = int((~hit & ~low & sel).sum())
    for t in np.unique(typ):
        if t != 0:
            out["by_type"][int(t)] = int((typ == t).sum())
    for mo in np.unique(month):
        sel = month == mo
        out["monthly"][mo] = int(((typ == 0) & ~low & sel).sum())
    return out


def merge(total, part):
    for key in ("rows", "static", "veg"):
        total[key] = total.get(key, 0) + part[key]
    for t, n in part["by_type"].items():
        total.setdefault("by_type", {})[t] = total.get("by_type", {}).get(t, 0) + n
    for mo, n in part["monthly"].items():
        total.setdefault("monthly", {})[mo] = total.get("monthly", {}).get(mo, 0) + n
    for name in ("exact", "neighbourhood_3x3"):
        tot = total.setdefault(name, {"static_removed": 0, "veg_removed": 0, "removed_by_type": {}, "kept_not_low": {}})
        tot["static_removed"] += part[name]["static_removed"]
        tot["veg_removed"] += part[name]["veg_removed"]
        for t, n in part[name]["removed_by_type"].items():
            tot["removed_by_type"][t] = tot["removed_by_type"].get(t, 0) + n
        for mo, n in part[name]["kept_not_low"].items():
            tot["kept_not_low"][mo] = tot["kept_not_low"].get(mo, 0) + n
    return total


def summarize(total, name):
    t = total[name]
    biases = [100 * (t["kept_not_low"].get(mo, 0) - true) / true for mo, true in total["monthly"].items() if true > 0]
    return {
        "recall_pct": round(100 * t["static_removed"] / total["static"], 2) if total["static"] else None,
        "false_drop_pct": round(100 * t["veg_removed"] / total["veg"], 3) if total["veg"] else None,
        "static_rows_removed": t["static_removed"], "static_rows_total": total["static"],
        "veg_rows_falsely_removed": t["veg_removed"], "veg_rows_total": total["veg"],
        "recall_by_type_pct": {str(ty): round(100 * t["removed_by_type"].get(ty, 0) / n, 1) for ty, n in sorted(total.get("by_type", {}).items())},
        "net_monthly_bias_pct": {"median": round(float(np.median(biases)), 3), "min": round(min(biases), 3), "max": round(max(biases), 3)} if biases else None,
    }


def validate_region(region):
    mask, src_rows, src_static = build_mask(region)
    mask3 = neighbourhood(mask)
    total = {}
    for df in read_year_files(region, "VIIRS_NOAA20_SP", TEST_YEARS):
        merge(total, score(df, mask, mask3))
    if not total:
        raise SystemExit(f"No NOAA-20 country files for {region} in {TEST_YEARS}. Run 01b_fetch_country.py first.")
    # Without any mask, every row of every type counts as kept. Its net bias is the static share among not-low rows.
    static_share = 100 * total["static"] / total["veg"] if total["veg"] else None
    return {
        "mask_source_rows": src_rows, "mask_source_static_rows": src_static, "mask_locations_exact": int(len(mask)),
        "mask_locations_3x3": int(len(mask3)), "test_rows": total["rows"], "test_months": len(total["monthly"]),
        "test_static_share_pct": round(100 * total["static"] / total["rows"], 2),
        "static_rows_as_pct_of_true_vegetation_rows": round(static_share, 3) if static_share is not None else None,
        "exact": summarize(total, "exact"), "neighbourhood_3x3": summarize(total, "neighbourhood_3x3"),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region")
    args = ap.parse_args()
    regions = load_regions()
    wanted = [args.region] if args.region else list(regions)
    out_path = PROCESSED / "mask_validation.json"
    existing = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"regions": {}}
    for region in wanted:
        print(f"{region}: building the mask from SNPP {MASK_YEARS[0]}-{MASK_YEARS[1]}, testing on NOAA-20 {TEST_YEARS[0]}-{TEST_YEARS[1]} ...", flush=True)
        existing["regions"][region] = validate_region(region)
        r = existing["regions"][region]
        print(f"  exact: recall {r['exact']['recall_pct']}%, false drops {r['exact']['false_drop_pct']}% | "
              f"3x3: recall {r['neighbourhood_3x3']['recall_pct']}%, false drops {r['neighbourhood_3x3']['false_drop_pct']}%", flush=True)
    existing["design"] = {
        "mask": f"VIIRS_SNPP_SP {MASK_YEARS[0]}-{MASK_YEARS[1]} yearly country files, rows with type != 0, matched at {ROUND_DEG} degrees",
        "test": f"VIIRS_NOAA20_SP {TEST_YEARS[0]}-{TEST_YEARS[1]} yearly country files, treated as if they had no type column",
        "recall": "share of type != 0 rows the mask removes", "false_drop": "share of type 0 (vegetation fire) rows the mask removes",
        "net_monthly_bias": "(kept rows that are not low confidence - true type 0 rows that are not low confidence) / true, per month",
    }
    done = sorted(existing["regions"])
    pending = [r for r in regions if r not in existing["regions"]]
    existing["status"] = "complete" if not pending else f"partial: {', '.join(pending)} not yet validated"
    existing["validated_regions"] = done
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(f"wrote {out_path} (status: {existing['status']})")


if __name__ == "__main__":
    main()
