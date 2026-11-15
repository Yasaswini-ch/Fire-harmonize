"""Shared paths and config helpers for the pipeline."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
PROCESSED = ROOT / "data" / "processed"


def load_regions():
    """Return {region_key: {"name", "bbox"}} from config/regions.json."""
    path = ROOT / "config" / "regions.json"
    if not path.exists():
        raise SystemExit(f"Missing {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def get_map_key():
    """FIRMS_MAP_KEY from the environment, else from .env. Never hardcoded."""
    key = os.environ.get("FIRMS_MAP_KEY")
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "FIRMS_MAP_KEY":
                key = value.strip().strip("\"'")
    if not key or key.startswith("your_"):
        raise SystemExit(
            "FIRMS_MAP_KEY is not set. Copy .env.example to .env and put your key there "
            "(get one at https://firms.modaps.eosdis.nasa.gov/api/map_key/)."
        )
    return key
