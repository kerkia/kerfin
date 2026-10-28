"""The web browsers installed for the user, to open sign-in pages in the one they choose.

Windows lists them in the registry under Clients\\StartMenuInternet (the same list as the
default-apps settings). Elsewhere, and for "default", the system's default browser opens.
"""

from __future__ import annotations

import logging
import shlex
import subprocess
import sys
import webbrowser
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT = "default"


@dataclass(frozen=True)
class Browser:
    id: str
    name: str
    executable: str


def installed() -> list[Browser]:
    if sys.platform != "win32":
        return []
    import winreg

    found: dict[str, Browser] = {}
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            clients = winreg.OpenKey(root, r"SOFTWARE\Clients\StartMenuInternet")
        except OSError:
            continue
        with clients:
            index = 0
            while True:
                try:
                    key_name = winreg.EnumKey(clients, index)
                except OSError:
                    break
                index += 1
                browser = _read(clients, key_name)
                if browser and browser.id not in found:
                    found[browser.id] = browser
    return sorted(found.values(), key=lambda b: b.name.lower())


def _read(clients: object, key_name: str) -> Browser | None:
    import winreg

    try:
        with winreg.OpenKey(clients, key_name) as key:  # type: ignore[arg-type]
            name = winreg.QueryValue(key, None) or key_name
            command = winreg.QueryValue(key, r"shell\open\command")
    except OSError:
        return None
    executable = _executable(command)
    if not executable or not Path(executable).is_file():
        return None
    # Ids stay stable across versions ("FIREFOX.EXE", "Microsoft Edge"...).
    return Browser(id=key_name.split("-")[0].lower(), name=name, executable=executable)


def _executable(command: str) -> str | None:
    command = command.strip()
    if command.startswith('"'):
        return command[1:].split('"', 1)[0]
    parts = shlex.split(command, posix=False)
    return parts[0] if parts else None


def open_url(url: str, browser_id: str = DEFAULT) -> None:
    """Opens `url` in the chosen browser, or the default one if it isn't installed anymore."""
    for browser in installed() if browser_id != DEFAULT else []:
        if browser.id == browser_id:
            try:
                subprocess.Popen([browser.executable, url], close_fds=True)
                return
            except OSError:
                log.warning("Could not start %s; using the default browser", browser.name)
            break
    webbrowser.open(url)
