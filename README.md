# Kerfin

A personal finance aggregator for family and friends: one place to see bank accounts,
French life insurance (assurance-vie), PER, PEA, crowdfunding and crypto.

Kerfin is a desktop app. Data is collected and stored **on each user's own computer**,
encrypted with their passphrase; credentials never leave it. See
[docs/architecture.md](docs/architecture.md).

## Install

Download `Kerfin_x.y.z_x64-setup.exe` from the
[latest release](../../releases/latest) and run it. It installs for the current Windows user
only, so no admin rights are needed. Windows may warn about an unknown publisher, because
the installer isn't code-signed: choose "More info", then "Run anyway". Kerfin then updates
itself.

## Repository layout

| Path | Content |
|---|---|
| `engine/` | Python engine: connectors, sync jobs, encrypted vault, local API |
| `packages/core/` | TypeScript data model and analytics, shared with a future web version |
| `apps/desktop/` | React interface (`src/`) and Tauri shell (`src-tauri/`) |
| `scripts/` | Release helpers: bundled engine build, version stamping |
| `.github/workflows/` | Tests, then a release, on every push to `main` |

## Development

Requirements: [uv](https://docs.astral.sh/uv/) and Node.js 22+. Building the desktop shell
also needs Rust and the MSVC build tools, but the UI can be developed in a browser without them.

```bash
npm install
cd engine && uv sync && uv run kerfin-engine woob-modules --install && cd ..
```

Run the engine with the demo institution, then the UI, and open http://localhost:5173:

```bash
cd engine
KERFIN_TOKEN=dev KERFIN_DEV_ORIGIN=http://localhost:5173 KERFIN_DEMO=1 KERFIN_DATA_DIR=../build/dev-data uv run kerfin-engine serve --port 8765
```

```bash
npm run dev
```

The demo bank accepts any login, asks for an SMS code (any 6 digits), fails with the
password `wrong`, and shows a QR code to scan with the password `qr`.

Tests: `npm test`, `npm run typecheck`, and `uv run pytest` in `engine/`.

To test a real login from the terminal: `uv run kerfin-engine probe boursobank` in
`engine/` (`--redact` hides amounts, to share the output).

## Releases

Every push to `main` that passes the tests is published as version `<VERSION>.<build number>`
(see [VERSION](VERSION)). The workflow builds the engine (`scripts/build_engine.py`), the
installer, and `latest.json`, which installed copies check every few hours.

Updates are signed. The private key and its password are GitHub secrets
(`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Keep a copy of both
somewhere safe: without them, installed copies can never be updated again.
