"""Filesystem locations used by the engine.

All per-user locations go through platformdirs so the same code works on Windows and Linux.
"""

from __future__ import annotations

import os
from pathlib import Path

import platformdirs

APP_NAME = "Kerfin"

# engine/ in a source checkout. The packaged desktop app sets the KERFIN_* variables instead.
ENGINE_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    override = os.environ.get("KERFIN_DATA_DIR")
    path = Path(override) if override else Path(platformdirs.user_data_dir(APP_NAME, appauthor=False))
    path.mkdir(parents=True, exist_ok=True)
    return path


def woob_modules_dir() -> Path:
    override = os.environ.get("KERFIN_WOOB_MODULES")
    return Path(override) if override else ENGINE_ROOT / "vendor" / "woob-modules"
