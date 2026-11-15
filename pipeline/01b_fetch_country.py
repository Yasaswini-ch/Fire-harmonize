"""Download NASA FIRMS yearly country archives, crop them to each region's box, and save the rows in
data/raw/{region}/{SOURCE}/ where 02_prepare.py reads them. No API key needed.

Source:  https://firms.modaps.eosdis.nasa.gov/data/country/{sensor}/{year}/{sensor}_{year}_{Country}.csv
Covers:  MODIS 2000-2025, VIIRS Suomi NPP 2012-2025, VIIRS NOAA-20 2018-2025. The current year is not in
         the yearly files; 01_fetch.py (API) fills it.
Output:  country_{year}_{Country}.csv per source folder; same columns as the API chunks, so 02_prepare.py
         reads them unchanged and drops any rows that also came from the API (it de-duplicates).
Resumable: an output file that exists is skipped. The big download is deleted after cropping.

Run (PowerShell):
    python pipeline/01b_fetch_country.py --region zambia
    python pipeline/01b_fetch_country.py --dry-run
"""
import argparse
import time

import pandas as pd
import requests

from common import RAW, load_regions

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
SOURCES = {  # FIRMS sensor path -> (our source folder, first year, last year)
    "modis": ("MODIS_SP", 2000, 2025),
    "viirs-snpp": ("VIIRS_SNPP_SP", 2012, 2025),
    "viirs-jpss1": ("VIIRS_NOAA20_SP", 2018, 2025),
}
TMP = RAW / "_country_tmp"
RETRIES = 4


def download(url, dest):
    """True if saved, False on 404 (year not published). Raises after repeated failures."""
    for attempt in range(1, RETRIES + 1):
        try:
            with requests.get(url, stream=True, timeout=180) as r:
                if r.status_code == 404:
                    return False
                r.raise_for_status()
                part = dest.with_suffix(".part")
                with open(part, "wb") as f:
                    for block in r.iter_content(1 << 20):
                        f.write(block)
                part.replace(dest)
                return True
        except requests.RequestException as err:
            if attempt == RETRIES:
                raise SystemExit(f"Download failed after {RETRIES} tries: {url} ({err})")
            time.sleep(5 * attempt)


def crop(src, out, bbox):
    west, south, east, north = bbox
    kept = 0
    first = True
    for chunk in pd.read_csv(src, dtype=str, chunksize=500_000):
        lat = chunk["latitude"].astype(float)
        lon = chunk["longitude"].astype(float)
        sel = chunk[(lat >= south) & (lat <= north) & (lon >= west) & (lon <= east)]
        kept += len(sel)
        sel.to_csv(out, mode="w" if first else "a", header=first, index=False)
        first = False
    return kept


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    regions = load_regions()
    wanted = [args.region] if args.region else list(regions)
    TMP.mkdir(parents=True, exist_ok=True)
    for rid in wanted:
        if rid not in regions:
            raise SystemExit(f"Unknown region {rid}. Known: {', '.join(regions)}")
        cfg = regions[rid]
        if not cfg.get("countries"):
            raise SystemExit(f"Region {rid} has no 'countries' list in config/regions.json")
        for sensor, (folder, y0, y1) in SOURCES.items():
            out_dir = RAW / rid / folder
            out_dir.mkdir(parents=True, exist_ok=True)
            for country in cfg["countries"]:
                for year in range(y0, y1 + 1):
                    name = f"{sensor}_{year}_{country}.csv"
                    out = out_dir / f"country_{year}_{country}.csv"
                    if out.exists():
                        continue
                    if args.dry_run:
                        print(f"would fetch {name} -> {out}")
                        continue
                    tmp = TMP / name
                    if not download(f"{BASE}/{sensor}/{year}/{name}", tmp):
                        print(f"{rid} {name}: not published (404), skipped", flush=True)
                        continue
                    kept = crop(tmp, out.with_suffix(".part"), cfg["bbox"])
                    out.with_suffix(".part").replace(out)
                    tmp.unlink()
                    print(f"{rid} {name}: {kept} rows inside the region box", flush=True)


if __name__ == "__main__":
    main()
