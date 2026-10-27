# kerfin-engine

Python engine of Kerfin: collects financial data through connectors, keeps it in the
encrypted vault, and serves it to the desktop UI over a local API.
See the [root README](../README.md) for setup and [docs/architecture.md](../docs/architecture.md)
for the design.

- `domain.py`: normalised accounts, holdings and transactions
- `connectors/`: the connector contract, the Woob and demo connectors, and `registry.py`
- `institutions.py`: supported institutions and the connector each one uses
- `vault.py`: the encrypted file (Argon2id + AES-256-GCM)
- `store.py`: the in-memory SQLite database saved into the vault
- `sync.py`: background sync jobs that can ask the user questions
- `server.py`: the local HTTP API (`kerfin-engine serve`)
- `woob_modules.py`: installs the Woob site modules matching the pinned Woob core
- `cli.py`: `kerfin-engine` command (serve, institutions, login probe)
