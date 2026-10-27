"""Set the app version everywhere it is declared: `python scripts/set_version.py 0.1.42`."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f"No version found in {path}")
    path.write_text(updated, encoding="utf-8")


def main(version: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit(f"Not a version: {version}")
    conf = ROOT / "apps/desktop/src-tauri/tauri.conf.json"
    data = json.loads(conf.read_text(encoding="utf-8"))
    data["version"] = version
    conf.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    replace(ROOT / "apps/desktop/src-tauri/Cargo.toml", r'^version = ".*"$', f'version = "{version}"')
    replace(ROOT / "engine/pyproject.toml", r'^version = ".*"$', f'version = "{version}"')
    replace(ROOT / "apps/desktop/package.json", r'^  "version": ".*",$', f'  "version": "{version}",')


if __name__ == "__main__":
    main(sys.argv[1])
