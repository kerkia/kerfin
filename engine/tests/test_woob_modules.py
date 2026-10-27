from __future__ import annotations

import io
import tarfile
from pathlib import Path

import pytest

from kerfin_engine import woob_modules


def _archive(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, content in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def test_install_strips_archive_prefix(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = _archive(
        {
            "woob-abc-modules/modules/spirica/__init__.py": b"# spirica",
            "woob-abc-modules/modules/spirica/modules/nested.py": b"# nested",
            "woob-abc-modules/README": b"outside",
        }
    )
    monkeypatch.setattr(woob_modules.urllib.request, "urlopen", lambda url, timeout: io.BytesIO(data))
    target = tmp_path / "woob-modules"

    assert woob_modules.install(target, "abc") == "abc"

    assert (target / "spirica" / "__init__.py").read_bytes() == b"# spirica"
    assert (target / "spirica" / "modules" / "nested.py").is_file()
    assert not (target / "README").exists()
    assert woob_modules.installed_commit(target) == "abc"


def test_install_rejects_path_traversal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = _archive({"woob-abc-modules/modules/../../evil.py": b"x"})
    monkeypatch.setattr(woob_modules.urllib.request, "urlopen", lambda url, timeout: io.BytesIO(data))

    with pytest.raises(tarfile.FilterError):
        woob_modules.install(tmp_path / "woob-modules", "abc")
    assert not (tmp_path / "evil.py").exists()
