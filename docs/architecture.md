# Architecture

## Decisions

- **Finary collects, Kerfin analyses** (decided 2026-10-28). Logging in to each bank and
  insurer website (Woob) failed for every real institution: bot protection, changed pages,
  refused logins. Finary maintains those connections; Kerfin reads the result through the
  read-only connector Finary offers to AI assistants (MCP), refreshes it at each unlock,
  keeps daily snapshots, and builds the analyses Finary doesn't offer. Finary therefore
  holds the users' account access; Kerfin only holds a revocable read-only token.

- **Audience: family and friends**, not a public service. Each user runs their own copy.
- **Desktop app, local data.** Logins run from the user's machine (home IP, SMS codes at hand),
  so no server ever holds anyone's bank credentials. This also keeps Kerfin out of the
  PSD2 account-information-service regime, which applies to services accessing other
  people's accounts.
- **Web later, without a rewrite.** A future web version would sync end-to-end encrypted
  data to the cloud and decrypt it in the browser. To keep that cheap:
  - the UI is React + TypeScript and talks to the engine only through one data interface;
  - all business logic (net worth, allocation, performance) lives in the shared TypeScript
    core, not in Python, so the browser can run it on decrypted data;
  - the Python engine stays thin: connectors, sync, storage.
- **Platforms: Windows first, Linux later.** All paths go through `platformdirs`; no
  Windows-only APIs (e.g. the credential vault is passphrase-based, not the Windows keyring).
- **Language: English first, French later.** The engine returns stable codes
  (`ErrorCode`, `AccountKind`...) that the UI translates; it never builds user-facing
  sentences, except messages relayed verbatim from a bank's website. UI strings go through
  an i18n layer from day one.

## Components

```
Desktop app (Tauri, apps/desktop)
├─ React + TS UI (src/)          ← reusable on web; reaches data only through src/engine.ts
├─ TS core (packages/core)       ← model and analytics, reusable on web
├─ Rust shell (src-tauri/)       ← window, engine process, updater
└─ Python engine (engine/, bundled with its own Python; 127.0.0.1 + per-launch token)
   ├─ connectors: Finary (MCP), manual, demo; Woob kept for existing connections only
   ├─ sync jobs: "sync now", pausing for login challenges that the UI answers
   └─ vault: in-memory SQLite, saved encrypted after each change
```

## Security model

- **Vault.** All data, credentials included, is one file encrypted with AES-256-GCM under a
  key derived from the user's passphrase with Argon2id (64 MiB, 3 passes). The database only
  exists in memory while unlocked; nothing is written in clear. The passphrase can't be
  recovered. Passwords are stored only if the user ticks "remember"; otherwise each sync
  asks for them.
- **Locking.** The vault locks after 15 minutes without activity (configurable) and when
  the app closes.
- **Local API.** The engine listens on 127.0.0.1 only, on a random port, and requires a
  token the shell generates at each launch. It rejects requests whose Host isn't the
  loopback address (DNS rebinding) and marks every response `no-store`, so the WebView's
  disk cache never holds financial data.
- **Bank connections.** The engine checks websites against its own certificate list
  (certifi) and ignores variables that would add trusted certificates. On a network that
  inspects HTTPS traffic, syncs therefore fail (`insecure_connection`) instead of exposing
  credentials.
- **Location.** Data lives in `%LOCALAPPDATA%\app.kerfin.desktop\data` (Linux:
  `~/.local/share/app.kerfin.desktop/data`), outside the roaming profile and outside the
  folders OneDrive backs up.
- **Updates.** Releases are signed with a key held in GitHub secrets; the app refuses any
  update whose signature doesn't match the public key it ships with.

Limits: anyone administering the computer, or software running with the user's rights
while the vault is unlocked, can read memory, keystrokes or the screen. The vault protects
data at rest (stolen or backed-up disk, other users), not a compromised session.

## Distribution and updates

- `.github/workflows/release.yml`: on every push to `main`, run the tests, then build and
  publish a GitHub release `v<VERSION>.<run number>` with the NSIS installer, its signature
  and `latest.json`.
- The installer is per-user (`%LOCALAPPDATA%\Kerfin`): no admin rights needed.
- The app checks `releases/latest/download/latest.json` at start and every 6 hours. While
  the vault is locked it installs at once; otherwise it offers "Restart to update".
- `scripts/build_engine.py` bundles a relocatable CPython (python-build-standalone, via uv),
  the engine and its dependencies, and the matching Woob modules.

## Market data

The Investments page analyses the funds and shares Finary reports (ISIN, value, price,
fees). `engine/src/kerfin_engine/market.py` collects, after each Finary sync:

- **Price histories** from Yahoo Finance's public quote data, found by ISIN or else by the
  fund's name. A candidate is kept only if its latest price matches Finary's price for the
  security (within 3%, after currency conversion), so a wrong share class is never used.
  Closes are adjusted for distributions. Unmatched securities are retried weekly.
- **Exchange rates** from the ECB's daily reference rates (official, free).
- **What each security is**: its CFI code (ISO 10962) from ESMA's register of financial
  instruments (FIRDS, the EU regulator's open data), looked up every 90 days. It tells
  company shares (E…, REITs CB…) from funds (C…, with what they hold: E equities, C
  commodities), commodity ETCs and notes (EY…, D…) and bonds (DB…).
- **Company shares**: sector and industry from the quote search, country from Wikidata
  (open data), else the ISIN's country.

Classification (`packages/core/src/investments.ts`): a fund or note named after a resource
holds the resource itself when the register says so (ETCs, notes, commodity funds) or its
name says physical; otherwise it holds the producers. UCITS funds can't own metal, so a
"gold" fund holds gold miners. A company's theme comes from its industry (oil & gas, gold,
uranium…). Sectors follow GICS as MSCI's factsheets name them, with one addition:
"Precious Metals Mining" (gold, silver and other precious metals miners) apart from the
rest of Materials. Index weights get the same split from the MSCI World Materials
factsheet's sub-industries: exactly for MSCI World, approximately for ACWI; other indices
keep Materials whole.
Commodities held as such have no sector or country and are left out of those breakdowns.

Fund composition (country, sector) comes from the index each equity fund follows,
matched by name: MSCI publishes every index's weights in a monthly public factsheet, and
`scripts/update_index_profiles.py` reads them at each release into
`engine/src/kerfin_engine/data/index_profiles.json`. A fund of one sector (Health Care,
Technology…) is all in that sector, with the countries of MSCI World's index for that
sector (or of its region's index). US funds (S&P 500, Nasdaq) use MSCI North America as
an approximation. Other funds count as not covered, and the page says which share of the
money each breakdown covers.

The performance chart prices today's holdings over the period as if held unchanged,
chaining day-to-day returns of the holdings priced on both days, in the chosen currency.
All of this lives in the vault: prices aren't personal, but which securities someone holds
is. The analytics are in `packages/core/src/investments.ts`.

## Connectors

### Finary

`connectors/finary.py` is an MCP client (JSON-RPC over HTTP) with OAuth 2 sign-in:

- **Sign-in.** Kerfin discovers Finary's authorization server from the MCP endpoint,
  registers itself as a public client, and opens Finary's consent page in the user's
  browser with PKCE and a random `state`. Finary redirects to the engine at
  `/finary/callback`, the only address served without the API token (the `state` stands
  in for it). The client id and refresh token go to the vault.
- **Sync.** At each unlock the UI syncs the Finary connection: the refresh token buys an
  access token (a rotated refresh token is saved), then the `accounts` and `holdings`
  tools are called. Each sync writes a balance snapshot per account and day.
- **Reading answers.** Finary names its tools but doesn't document their answers, so the
  mapping looks for the usual field names. When an answer can't be read, the error and the
  log give its structure (field names and types, never values).

All connectors implement `kerfin_engine.connectors.Connector` and return the normalised
types of `kerfin_engine.domain`. Login challenges (SMS codes, app validation, redirects)
go through an `InteractionHandler`: the terminal today, the desktop UI later. Without a
handler a connector runs unattended and fails with `INTERACTION_REQUIRED` instead of
triggering a challenge.

### Woob

[Woob](https://woob.tech) scrapes the websites of French banks and insurers. Its PyPI
releases and module repository lag far behind its git history, so:

- the Woob core is pinned to a git commit in `engine/pyproject.toml`;
- `kerfin-engine woob-modules --install` downloads the site modules of that same commit;
- updating Woob = bumping the commit, then reinstalling the modules.

The packaged app ships the modules of the pinned commit. To deliver site fixes, bump the
commit and push: the release pipeline updates every installed copy.

- The catalogue offers every module that reads bank or investment accounts and loads with
  the packages the engine ships. Installing the modules saves that list beside them
  (`kerfin-catalog.json`), since loading every module takes seconds.
- `connectors/woob_fixes.py` patches what the pinned commit doesn't handle, such as
  BoursoBank's QR code check ("vérification de proximité"), which the UI shows for the
  user to scan with the bank's app.
- Some websites turn away anything that isn't a real browser (e.g. Cloudflare bot
  protection answering 403, or connections dropped during the TLS handshake). Kerfin
  reports these as `blocked` or `connection_failed` and doesn't try to get around them.
