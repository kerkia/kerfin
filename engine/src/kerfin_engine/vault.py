"""The encrypted file holding all of a user's data, credentials included.

The whole database is encrypted with AES-256-GCM under a key derived from the user's
passphrase with Argon2id. Nothing is ever written to disk in clear: the database lives in
memory while the vault is unlocked. The passphrase cannot be recovered.
"""

from __future__ import annotations

import base64
import hmac
import json
import math
import os
import shutil
import struct
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

MAGIC = b"KERFIN\x00\x01"
# OWASP-recommended Argon2id settings; about half a second on a laptop.
DEFAULT_KDF = {"kdf": "argon2id", "memory_cost": 65536, "iterations": 3, "lanes": 4}
MIN_PASSPHRASE_LENGTH = 8
FREE_ATTEMPTS = 3  # wrong passphrases in a row before Kerfin makes the user wait
FIRST_WAIT = 6 * 60  # seconds after the third; doubled at each wrong passphrase after that


class VaultError(Exception):
    pass


class WrongPassphrase(VaultError):
    pass


def check_length(passphrase: str) -> None:
    if len(passphrase) < MIN_PASSPHRASE_LENGTH:
        raise VaultError(f"The passphrase needs at least {MIN_PASSPHRASE_LENGTH} characters")


def derive_key(passphrase: str, header: dict[str, Any]) -> bytes:
    if header.get("kdf") != "argon2id":
        raise VaultError(f"Unsupported key derivation {header.get('kdf')!r}")
    return Argon2id(
        salt=base64.b64decode(header["salt"]),
        length=32,
        iterations=header["iterations"],
        lanes=header["lanes"],
        memory_cost=header["memory_cost"],
    ).derive(passphrase.encode())


def seal(key: bytes, header: dict[str, Any], plaintext: bytes) -> bytes:
    header_bytes = json.dumps(header, sort_keys=True).encode()
    prefix = MAGIC + struct.pack(">I", len(header_bytes)) + header_bytes
    nonce = os.urandom(12)
    # The header is authenticated too, so its KDF settings cannot be tampered with.
    return prefix + nonce + AESGCM(key).encrypt(nonce, plaintext, prefix)


def parse(blob: bytes) -> tuple[dict[str, Any], bytes, bytes, bytes]:
    """(header, authenticated prefix, nonce, ciphertext)."""
    if not blob.startswith(MAGIC):
        raise VaultError("Not a Kerfin vault")
    (length,) = struct.unpack_from(">I", blob, len(MAGIC))
    start = len(MAGIC) + 4
    prefix = blob[: start + length]
    header = json.loads(blob[start : start + length])
    return header, prefix, blob[start + length : start + length + 12], blob[start + length + 12 :]


class Vault:
    """One encrypted file. While unlocked, the derived key is kept in memory to save changes."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._key: bytes | None = None
        self._header: dict[str, Any] | None = None

    @property
    def exists(self) -> bool:
        return self.path.exists()

    @property
    def unlocked(self) -> bool:
        return self._key is not None

    def create(self, passphrase: str, data: bytes) -> None:
        if self.exists:
            raise VaultError("A vault already exists")
        check_length(passphrase)
        self._header = {**DEFAULT_KDF, "salt": base64.b64encode(os.urandom(16)).decode()}
        self._key = derive_key(passphrase, self._header)
        self.save(data)

    def change_passphrase(self, current: str, new: str, data: bytes) -> None:
        """Encrypts the vault, backup included, under a new passphrase and a new salt."""
        if self._key is None or self._header is None:
            raise VaultError("The vault is locked")
        if not hmac.compare_digest(derive_key(current, self._header), self._key):
            raise WrongPassphrase()
        check_length(new)
        self._header = {**DEFAULT_KDF, "salt": base64.b64encode(os.urandom(16)).decode()}
        self._key = derive_key(new, self._header)
        self.save(data)
        # The backup just made still opens with the old passphrase.
        shutil.copy2(self.path, self.path.with_suffix(".bak"))

    def unlock(self, passphrase: str) -> bytes:
        header, prefix, nonce, ciphertext = parse(self.path.read_bytes())
        key = derive_key(passphrase, header)
        try:
            data = AESGCM(key).decrypt(nonce, ciphertext, prefix)
        except InvalidTag:
            raise WrongPassphrase() from None
        self._key, self._header = key, header
        return data

    def save(self, data: bytes) -> None:
        if self._key is None or self._header is None:
            raise VaultError("The vault is locked")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        with open(temporary, "wb") as file:
            file.write(seal(self._key, self._header, data))
            file.flush()
            os.fsync(file.fileno())
        if self.path.exists():
            # Keep the previous version: a crash can't then cost more than the last change.
            shutil.copy2(self.path, self.path.with_suffix(".bak"))
        os.replace(temporary, self.path)

    def lock(self) -> None:
        # Python can't wipe memory; dropping the references is the best we can do.
        self._key = None
        self._header = None


class Attempts:
    """Wrong passphrases in a row, kept on disk so that restarting Kerfin doesn't end a wait.

    This only slows down guessing through Kerfin. Someone holding a copy of the vault file
    tries passphrases on their own machines, where only the passphrase's strength counts.
    """

    def __init__(self, path: Path, clock: Callable[[], float] = time.time) -> None:
        self.path = path
        self.clock = clock  # replaced in tests

    def _read(self) -> tuple[int, float]:
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
            return int(saved["failures"]), float(saved["until"])
        except (OSError, ValueError, KeyError, TypeError):
            return 0, 0.0

    def wait(self) -> int:
        """Seconds before the next passphrase may be tried."""
        _failures, until = self._read()
        return max(0, math.ceil(until - self.clock()))

    def failed(self) -> None:
        failures, until = self._read()
        failures += 1
        if failures >= FREE_ATTEMPTS:
            until = self.clock() + FIRST_WAIT * 2 ** min(failures - FREE_ATTEMPTS, 20)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"failures": failures, "until": until}), encoding="utf-8")

    def succeeded(self) -> None:
        self.path.unlink(missing_ok=True)
