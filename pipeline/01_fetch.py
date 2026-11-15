"""Download FIRMS archive (standard processing) data for every region in config/regions.json.

Resumable: chunks already on disk are skipped. Chunks are anchored to each source's first
available date and are MAX_DAYS long, so a chunk file may hold a few days outside --start/--end.

Examples (PowerShell):
    python pipeline/01_fetch.py --region western_na --start 2019-08-01 --end 2019-08-31
    python pipeline/01_fetch.py --dry-run
    python pipeline/01_fetch.py --nrt-tail
"""
import argparse
import csv
import io
import json
import re
import time
from collections import deque
from datetime import date, timedelta

import requests

from common import RAW, get_map_key, load_regions

BASE = "https://firms.modaps.eosdis.nasa.gov/api"
SP_SOURCES = ["MODIS_SP", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP"]
NRT_SOURCE = "VIIRS_NOAA20_NRT"  # fixed on purpose so the provisional tail never switches satellite
MAX_DAYS = 5  # FIRMS area API: DAY_RANGE 1..5
TILE_DEG = 5
MAX_RETRIES = 5
RATE_LIMIT, RATE_WINDOW = 4500, 600  # stay under 5000 transactions / 10 min
SLEEP = 0.1

_sent = deque()
_tiled = set()  # (region, source) pairs whose full box was rejected


class Rejected(Exception):
    """The server refused the request (not a transient error)."""


def throttle():
    now = time.monotonic()
    while _sent and now - _sent[0] > RATE_WINDOW:
        _sent.popleft()
    if len(_sent) >= RATE_LIMIT:
        wait = RATE_WINDOW - (now - _sent[0]) + 1
        print(f"rate limit window full, sleeping {wait:.0f}s")
        time.sleep(wait)
    _sent.append(time.monotonic())
    time.sleep(SLEEP)


def get_text(url, expect):
    """GET with backoff on 429/5xx/timeouts. `expect` is the header prefix of a valid body."""
    for attempt in range(MAX_RETRIES + 1):
        throttle()
        try:
            r = requests.get(url, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                err = f"HTTP {r.status_code}"
            elif r.status_code != 200:
                raise Rejected(f"HTTP {r.status_code}: {r.text[:200]}")
            elif r.text == "" or r.text.startswith(expect):
                return r.text
            elif re.search(r"limit|exceed", r.text, re.I):
                err = f"rate limit message: {r.text[:100]}"
            else:
                raise Rejected(r.text[:200])
        except (requests.Timeout, requests.ConnectionError) as e:
            err = type(e).__name__
        if attempt == MAX_RETRIES:
            raise RuntimeError(f"gave up after {MAX_RETRIES} retries: {err}")
        time.sleep(2**attempt)


def load_availability(key):
    text = get_text(f"{BASE}/data_availability/csv/{key}/ALL", "data_id")
    RAW.mkdir(parents=True, exist_ok=True)
    with open(RAW / "availability.csv", "w", encoding="utf-8", newline="") as f:
        f.write(text)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or not {"data_id", "min_date", "max_date"} <= set(rows[0]):
        raise SystemExit(f"Unexpected availability columns: {text.splitlines()[:2]}")
    return {
        r["data_id"]: (date.fromisoformat(r["min_date"]), date.fromisoformat(r["max_date"]))
        for r in rows
    }


def area_url(key, source, bbox, days, start):
    w, s, e, n = bbox
    return f"{BASE}/area/csv/{key}/{source}/{w},{s},{e},{n}/{days}/{start}"


def tiles(bbox):
    w, s, e, n = bbox
    out = []
    x = w
    while x < e:
        y = s
        while y < n:
            out.append((x, y, min(x + TILE_DEG, e), min(y + TILE_DEG, n)))
            y += TILE_DEG
        x += TILE_DEG
    return out


def merge(texts):
    """Concatenate CSV texts under one header, dropping rows duplicated on tile edges."""
    header, rows = None, []
    for t in texts:
        lines = t.splitlines()
        if lines:
            header = header or lines[0]
            rows += lines[1:]
    if header is None:
        return ""
    return "\n".join([header] + list(dict.fromkeys(rows))) + "\n"


def fetch_chunk(key, region, source, bbox, start, days, force_tiles):
    if not force_tiles and (region, source) not in _tiled:
        try:
            return get_text(area_url(key, source, bbox, days, start), "latitude")
        except Rejected as e:
            print(f"  full box rejected ({e}); using {TILE_DEG}x{TILE_DEG} tiles for {region}/{source}")
            _tiled.add((region, source))
    return merge(get_text(area_url(key, source, t, days, start), "latitude") for t in tiles(bbox))


def chunk_starts(anchor, avail_end, start, end):
    d = anchor
    while d <= min(end, avail_end):
        if d + timedelta(days=MAX_DAYS - 1) >= start:
            yield d
        d += timedelta(days=MAX_DAYS)


def run_job(key, region, bbox, dirname, source, anchor, avail_end, start, end, args):
    out = RAW / region / dirname
    starts = list(chunk_starts(anchor, avail_end, start, end))
    todo = [d for d in starts if not (out / f"{d}.csv").exists()]
    print(f"{region}/{dirname}: {len(starts)} chunks, {len(starts) - len(todo)} on disk, "
          f"{len(todo)} requests needed" + (" (x tiles if rejected)" if not args.tile else " (x tiles)"))
    failed = []
    if args.dry_run:
        return len(todo), failed
    out.mkdir(parents=True, exist_ok=True)
    for i, d in enumerate(todo, 1):
        days = min(MAX_DAYS, (avail_end - d).days + 1)
        try:
            text = fetch_chunk(key, region, source, bbox, d, days, args.tile)
        except (Rejected, RuntimeError) as e:
            print(f"  FAILED {region}/{dirname}/{d}: {e}")
            failed.append(d.isoformat())
            continue
        tmp = out / f"{d}.csv.part"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        tmp.replace(out / f"{d}.csv")
        if i % 50 == 0:
            print(f"  {i}/{len(todo)} chunks")
    return len(todo), failed


def acq_date_range_first_last(files):
    """min acq_date of the first non-empty chunk, max acq_date of the last non-empty chunk."""
    def dates(f):
        with open(f, encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        return [r["acq_date"] for r in rows]
    first = last = None
    for f in files:
        ds = dates(f)
        if ds:
            first = min(ds)
            break
    for f in reversed(files):
        ds = dates(f)
        if ds:
            last = max(ds)
            break
    return first, last


def write_manifest(new_failed):
    failed_path = RAW / "failed.json"
    failed = json.loads(failed_path.read_text(encoding="utf-8")) if failed_path.exists() else {}
    for k, v in new_failed.items():
        failed[k] = sorted(set(failed.get(k, [])) | set(v))
    manifest = {}
    for region_dir in sorted(p for p in RAW.iterdir() if p.is_dir()):
        for src_dir in sorted(p for p in region_dir.iterdir() if p.is_dir()):
            files = sorted(src_dir.glob("*.csv"))
            counts = {f.stem: max(0, len(f.read_bytes().splitlines()) - 1) for f in files}
            first, last = acq_date_range_first_last(files)
            name = f"{region_dir.name}/{src_dir.name}"
            still_failed = [d for d in failed.get(name, []) if d not in counts]
            failed[name] = still_failed
            manifest.setdefault(region_dir.name, {})[src_dir.name] = {
                "chunks": len(files),
                "rows": sum(counts.values()),
                "first_date": first,
                "last_date": last,
                "empty_chunks": [d for d, n in counts.items() if n == 0],
                "failed_chunks": still_failed,
            }
    for path, data in ((failed_path, failed), (RAW / "manifest.json", manifest)):
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {RAW / 'manifest.json'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region")
    ap.add_argument("--source", choices=SP_SOURCES)
    ap.add_argument("--start", type=date.fromisoformat)
    ap.add_argument("--end", type=date.fromisoformat)
    ap.add_argument("--dry-run", action="store_true", help="print number of requests only")
    ap.add_argument("--nrt-tail", action="store_true",
                    help="download VIIRS_NOAA20_NRT from the day after NOAA-20 SP ends to today")
    ap.add_argument("--tile", action="store_true", help="always use 5x5 degree tiles")
    args = ap.parse_args()

    regions = load_regions()
    if args.region:
        if args.region not in regions:
            raise SystemExit(f"Unknown region {args.region!r}. Known: {', '.join(regions)}")
        regions = {args.region: regions[args.region]}

    key = get_map_key()
    avail = load_availability(key)
    for s in sorted(s for s in avail if s in SP_SOURCES or (s.startswith("VIIRS") and s.endswith("_NRT"))):
        print(f"{s}: {avail[s][0]} to {avail[s][1]}")
    for s in SP_SOURCES:
        if s not in avail:
            raise SystemExit(f"{s} not in availability.csv")

    jobs = []  # (region, dirname, source, anchor, avail_end, start, end)
    for region in regions:
        if args.nrt_tail:
            nrt = NRT_SOURCE
            if nrt not in avail or "VIIRS_NOAA20_SP" not in avail:
                raise SystemExit(f"{nrt} or VIIRS_NOAA20_SP not in availability.csv")
            start = max(avail["VIIRS_NOAA20_SP"][1] + timedelta(days=1), avail[nrt][0])
            end = min(date.today(), avail[nrt][1])
            if start > end:
                print(f"{region}: nothing to download for {nrt}")
                continue
            print(f"NRT source {nrt}: {start} to {end} (provisional)")
            jobs.append((region, nrt.removesuffix("_NRT") + "_nrt", nrt, start, avail[nrt][1], start, end))
        else:
            for source in [args.source] if args.source else SP_SOURCES:
                lo, hi = avail[source]
                jobs.append((region, source, source, lo, hi, args.start or lo, args.end or hi))

    total, new_failed = 0, {}
    for region, dirname, source, anchor, avail_end, start, end in jobs:
        n, failed = run_job(key, region, regions[region]["bbox"], dirname, source,
                            anchor, avail_end, start, end, args)
        total += n
        if failed:
            new_failed[f"{region}/{dirname}"] = failed
    if args.dry_run:
        print(f"TOTAL requests needed: {total} (limit is 5000 per 10 min; script throttles)")
        return
    write_manifest(new_failed)
    if new_failed:
        print(f"{sum(map(len, new_failed.values()))} chunks failed; re-run to retry them.")


if __name__ == "__main__":
    main()
