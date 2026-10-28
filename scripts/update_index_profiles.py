"""Refreshes the country and sector weights of the main stock indices from MSCI's factsheets.

Kerfin estimates where an index fund invests from the index it tracks: MSCI publishes each
index's weights every month in a public factsheet (PDF). This script reads them and writes
engine/src/kerfin_engine/data/index_profiles.json, which ships with the app. It runs at
each release; if a factsheet can't be read, the previous weights of that index are kept.

Usage: uv run --no-project --with pypdf python scripts/update_index_profiles.py
"""

from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from pypdf import PdfReader

OUT = Path(__file__).resolve().parents[1] / "engine" / "src" / "kerfin_engine" / "data" / "index_profiles.json"
BASE = "https://www.msci.com/documents/10199/255599/"

# Index, factsheet, and the fund names it describes (JavaScript regular expressions,
# case-insensitive, tried in this order: the specific ones first). `approximate` marks
# indices standing in for another (e.g. MSCI North America for the S&P 500).
INDICES = [
    ("msci-acwi-imi", "MSCI ACWI IMI", "msci-acwi-imi.pdf", r"acwi imi", False),
    ("msci-acwi", "MSCI ACWI", "msci-acwi.pdf", r"acwi|all.country world|ftse all.world", False),
    ("msci-world-small-cap", "MSCI World Small Cap", "msci-world-small-cap-index.pdf", r"world small", False),
    ("msci-world-ex-usa", "MSCI World ex USA", "msci-world-ex-usa-index.pdf", r"world ex.?us", False),
    ("msci-world", "MSCI World", "msci-world-index.pdf", r"msci world|\bworld\b|monde|global equity|ftse developed(?! europe)", False),
    ("msci-europe-small-cap", "MSCI Europe Small Cap", "msci-europe-small-cap-index.pdf", r"europe small", False),
    ("msci-emu", "MSCI EMU", "msci-emu-index.pdf", r"\bemu\b|euro ?stoxx|eurozone|zone euro", False),
    ("msci-europe", "MSCI Europe", "msci-europe-index.pdf", r"europe|stoxx 600", False),
    ("msci-france", "MSCI France", "msci-france-index.pdf", r"france|cac ?40", False),
    ("msci-japan", "MSCI Japan", "msci-japan-index.pdf", r"japan|japon|topix|nikkei", False),
    ("msci-china", "MSCI China", "msci-china-index.pdf", r"china|chine", False),
    ("msci-pacific", "MSCI Pacific", "msci-pacific-index.pdf", r"pacific|pacifique|asia|asie", True),
    (
        "msci-emerging-markets",
        "MSCI Emerging Markets",
        "msci-emerging-markets-index-cad-gross.pdf",
        r"emerging|[ée]mergent|\bem\b",
        False,
    ),
    (
        "msci-north-america",
        "MSCI North America",
        "msci-north-america-index.pdf",
        r"s&p ?500|msci usa|nasdaq|\busa?\b|u\.s\.|[ée]tats.unis|am[ée]rique|north america",
        True,
    ),
]

SINGLE_COUNTRY = {"msci-france": "France", "msci-japan": "Japan", "msci-china": "China"}

WEIGHT = re.compile(r"([A-Z][A-Za-z.&,' -]+?) (\d+(?:\.\d+)?)%")


def weights(text: str, title: str) -> dict[str, float]:
    """The "Name 12.3%" pairs of a factsheet section, which ends at its first bare figure."""
    start = text.index(title) + len(title)
    section = []
    for line in text[start:].splitlines():
        if re.fullmatch(r"\s*\d+(\.\d+)?%\s*", line):
            break
        section.append(line)
    found = {name.strip(): float(value) for name, value in WEIGHT.findall(" ".join(section))}
    if not 90 <= sum(found.values()) <= 101:
        raise ValueError(f"{title}: weights add up to {sum(found.values()):.1f}%")
    return found


def profile(index_id: str, name: str, file: str, pattern: str, approximate: bool) -> dict[str, object]:
    request = urllib.request.Request(BASE + file, headers={"User-Agent": "Kerfin index profiles"})
    with urllib.request.urlopen(request, timeout=60) as response:
        text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(response.read())).pages)
    as_of = re.search(r"([A-Z]{3} \d{1,2}, \d{4}) Index Factsheet", text)
    return {
        "id": index_id,
        "name": name,
        "source": BASE + file,
        "as_of": as_of.group(1) if as_of else None,
        "match": pattern,
        "approximate": approximate,
        # Single-country indices have no country table.
        "countries": (
            weights(text, "COUNTRY WEIGHTS") if "COUNTRY WEIGHTS" in text else {SINGLE_COUNTRY[index_id]: 100.0}
        ),
        "sectors": weights(text, "SECTOR WEIGHTS"),
    }


def main() -> int:
    previous = {}
    if OUT.exists():
        previous = {p["id"]: p for p in json.loads(OUT.read_text(encoding="utf-8"))["indices"]}
    profiles, failed = [], []
    for index_id, name, file, pattern, approximate in INDICES:
        try:
            profiles.append(profile(index_id, name, file, pattern, approximate))
        except Exception as error:  # noqa: BLE001 - keep the last good weights of this index
            failed.append(f"{index_id}: {error}")
            if index_id in previous:
                profiles.append({**previous[index_id], "match": pattern, "approximate": approximate})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"indices": profiles}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(profiles)} index profiles written to {OUT}")
    for line in failed:
        print(f"kept previous weights: {line}", file=sys.stderr)
    return 0 if profiles else 1


if __name__ == "__main__":
    raise SystemExit(main())
