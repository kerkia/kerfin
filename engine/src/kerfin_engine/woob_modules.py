"""Install the Woob site modules that match the pinned Woob core.

Woob's PyPI releases and its module repository lag far behind its git history, so the
engine pins the core to a git commit (see pyproject.toml) and uses the modules of that
same commit, downloaded from GitLab over HTTPS. This keeps core and modules consistent
and avoids Woob's runtime module installer, whose signature check depends on a gpg
binary that is usually missing on Windows.
"""

from __future__ import annotations

import json
import shutil
import tarfile
import tempfile
import urllib.request
from importlib import metadata
from pathlib import Path, PurePosixPath

ARCHIVE_URL = "https://gitlab.com/woob/woob/-/archive/{commit}/woob-{commit}.tar.gz?path=modules"
COMMIT_FILE = "COMMIT"


def pinned_commit() -> str:
    direct_url = metadata.distribution("woob").read_text("direct_url.json")
    if not direct_url:
        raise RuntimeError("woob is not installed from git, so its commit is unknown")
    return json.loads(direct_url)["vcs_info"]["commit_id"]


def installed_commit(modules_dir: Path) -> str | None:
    marker = modules_dir / COMMIT_FILE
    return marker.read_text(encoding="utf-8").strip() if marker.is_file() else None


def install(modules_dir: Path, commit: str | None = None) -> str:
    """Download the modules of `commit` (default: the pinned one) into `modules_dir`."""
    commit = commit or pinned_commit()
    modules_dir.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=modules_dir.parent) as tmp:
        archive_path = Path(tmp) / "modules.tar.gz"
        with urllib.request.urlopen(ARCHIVE_URL.format(commit=commit), timeout=120) as response:
            with archive_path.open("wb") as archive_file:
                shutil.copyfileobj(response, archive_file)

        staging = Path(tmp) / "modules"
        with tarfile.open(archive_path) as archive:
            members = []
            for member in archive.getmembers():
                # Archive paths look like "woob-<commit>-modules/modules/<module>/...".
                parts = PurePosixPath(member.name).parts
                if "modules" not in parts[1:]:
                    continue
                relative = parts[parts.index("modules", 1) + 1 :]
                if not relative:
                    continue
                member.name = str(PurePosixPath(*relative))
                members.append(member)
            archive.extractall(staging, members=members, filter="data")

        (staging / COMMIT_FILE).write_text(commit, encoding="utf-8")
        if modules_dir.exists():
            shutil.rmtree(modules_dir)
        # Copy rather than rename: on Windows, antivirus scans of the freshly extracted
        # files make directory renames fail with "access denied".
        shutil.copytree(staging, modules_dir)
    return commit
