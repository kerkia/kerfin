"""Build the self-contained Python engine shipped inside the desktop app.

Output, in apps/desktop/src-tauri/engine-dist/ (bundled by Tauri as "engine/"):
  python/        a relocatable CPython (python-build-standalone, via uv) with the engine installed
  woob-modules/  the Woob site modules matching the pinned Woob core

Run from anywhere: `uv run --no-project python scripts/build_engine.py`.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
BUILD = ROOT / "build"
OUT = ROOT / "apps" / "desktop" / "src-tauri" / "engine-dist"
PYTHON_VERSION = (ENGINE / ".python-version").read_text().strip()
WINDOWS = sys.platform == "win32"
# Parts of the standard library the engine never uses.
PRUNE = ["Lib/test", "Lib/idlelib", "Lib/tkinter", "Lib/turtledemo", "Lib/ensurepip", "tcl", "include", "libs"]


def uv(*args: str, **kwargs: object) -> None:
    executable = shutil.which("uv")
    command = [executable] if executable else [sys.executable, "-m", "uv"]
    subprocess.run([*command, *args], check=True, **kwargs)  # type: ignore[arg-type]


def python_in(folder: Path) -> Path:
    return folder / "python.exe" if WINDOWS else folder / "bin" / "python3"


def main() -> None:
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(BUILD, ignore_errors=True)
    BUILD.mkdir()

    print(f"Python {PYTHON_VERSION}")
    uv("python", "install", PYTHON_VERSION, "--install-dir", str(BUILD / "pythons"), "--no-bin")
    # uv also adds a link (a junction on Windows) named after the minor version: skip it.
    [installed] = [p for p in (BUILD / "pythons").iterdir() if not (p.is_symlink() or p.is_junction()) and python_in(p).exists()]
    shutil.copytree(installed, OUT / "python", symlinks=True)
    python = python_in(OUT / "python")
    for relative in PRUNE:
        shutil.rmtree(OUT / "python" / relative, ignore_errors=True)

    print("Engine and dependencies")
    requirements = BUILD / "requirements.txt"
    uv("export", "--project", str(ENGINE), "--frozen", "--no-dev", "--no-hashes", "--no-emit-project",
       "--output-file", str(requirements))
    install = ["pip", "install", "--python", str(python), "--break-system-packages", "--compile-bytecode"]
    uv(*install, "-r", str(requirements))
    uv(*install, "--no-deps", str(ENGINE))

    print("Woob modules")
    env = {**os.environ, "KERFIN_WOOB_MODULES": str(OUT / "woob-modules")}
    subprocess.run([str(python), "-I", "-m", "kerfin_engine", "woob-modules", "--install"], check=True, env=env)

    print("Smoke test")
    subprocess.run([str(python), "-I", "-m", "kerfin_engine", "institutions"], check=True, env=env)
    subprocess.run(
        [str(python), "-I", "-c", "import kerfin_engine.server, kerfin_engine.connectors.woob_connector"],
        check=True,
        env=env,
    )
    print(f"Engine ready in {OUT}")


if __name__ == "__main__":
    main()
