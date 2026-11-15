"""Is Zambia's August 2026 near-real-time volume real? Independent check against other sensors and last year.

Run (PowerShell):  python pipeline/checks/nrt_check.py
Needs data/raw and FIRMS_MAP_KEY in .env (about 14 small FIRMS API requests). The key is read through common.get_map_key and
is never printed. Findings are written up in docs/nrt-check-august-2026.md.
"""
import io
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import RAW, ROOT, get_map_key, load_regions  # noqa: E402

BBOX = load_regions()["zambia"]["bbox"]  # west, south, east, north
AREA = ",".join(str(v) for v in BBOX)
KEY = get_map_key()


def fetch(source, start, end):
    frames, d = [], start
    while d <= end:
        days = min(5, (end - d).days + 1)
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{source}/{AREA}/{days}/{d.isoformat()}"
        r = requests.get(url, timeout=120)
        if r.status_code != 200 or not r.text.startswith("latitude"):
            raise SystemExit(f"{source} {d}: HTTP {r.status_code}")
        frames.append(pd.read_csv(io.StringIO(r.text), dtype=str))
        d += timedelta(days=days)
    return pd.concat(frames, ignore_index=True).drop_duplicates(subset=["latitude", "longitude", "acq_date", "acq_time"])


def viirs_simple(df):  # the same simple filter for every VIIRS series: drop low confidence
    return df[df["confidence"].str.strip().str.lower() != "l"]


def raw_month(folder, pattern, month):
    out = []
    for f in sorted((RAW / "zambia" / folder).glob(pattern)):
        df = pd.read_csv(f, usecols=["acq_date", "confidence", "latitude", "longitude", "acq_time"], dtype=str)
        out.append(df[df["acq_date"].str[:7] == month])
    if not out:
        return pd.DataFrame(columns=["acq_date", "confidence", "latitude", "longitude", "acq_time"])
    return pd.concat(out, ignore_index=True).drop_duplicates(subset=["latitude", "longitude", "acq_date", "acq_time"])


# 1. NOAA-20 near real time for August 2026 against NOAA-20 standard processing for August 2024 and 2025
n20_nrt = viirs_simple(raw_month("VIIRS_NOAA20_nrt", "*.csv", "2026-08"))
n20_sp25 = viirs_simple(raw_month("VIIRS_NOAA20_SP", "country_2025_*.csv", "2025-08"))
n20_sp24 = viirs_simple(raw_month("VIIRS_NOAA20_SP", "country_2024_*.csv", "2024-08"))
print("NOAA-20, same simple filter (low confidence dropped, no mask):")
print(f"  Aug 2024 SP  {len(n20_sp24):>9,}\n  Aug 2025 SP  {len(n20_sp25):>9,}\n  Aug 2026 NRT {len(n20_nrt):>9,}   ratio to Aug 2025: {len(n20_nrt) / len(n20_sp25):.2f}")
daily, daily25 = n20_nrt.groupby("acq_date").size(), n20_sp25.groupby("acq_date").size()
print(f"  daily NRT Aug 2026: min {daily.min():,} median {int(daily.median()):,} max {daily.max():,}; Aug 2025 SP: median {int(daily25.median()):,}")
print(f"  days above 3x the monthly median (a spike or a duplicated day would show here): {int((daily > 3 * daily.median()).sum())} of {len(daily)}")

# 2. independent instruments for August 2026: Suomi NPP near real time, and Aqua MODIS standard processing
#    (MODIS near real time only starts on 2026-09-01)
start, end = date(2026, 8, 1), date(2026, 8, 31)
snpp = viirs_simple(fetch("VIIRS_SNPP_NRT", start, end))
modis = fetch("MODIS_SP", start, end)
modis = modis[modis["satellite"].str.strip().str.lower().isin(["aqua", "a"]) & (pd.to_numeric(modis["confidence"]) >= 30)]
if "type" in modis:
    modis = modis[pd.to_numeric(modis["type"]) == 0]
cells = pd.read_parquet(ROOT / "data" / "interim" / "monthly_cells.parquet")
cells = cells[(cells["region"] == "zambia") & (cells["product"] == "modis_sp")]
modis_sp = cells.groupby(["year", "month"])["n_detections"].sum()
print(f"\nSuomi NPP NRT Aug 2026 {len(snpp):,}  (NOAA-20 / Suomi NPP = {len(n20_nrt) / len(snpp):.2f}; vs NOAA-20 SP Aug 2025 = {len(snpp) / len(n20_sp25):.2f})")
print(f"Aqua MODIS SP (Aqua, confidence >= 30, type 0): Aug 2025 {int(modis_sp[(2025, 8)]):,} | Aug 2026 {len(modis):,}   ratio {len(modis) / modis_sp[(2025, 8)]:.2f}")
