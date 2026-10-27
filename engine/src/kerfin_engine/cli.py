"""Command-line entry point, used for development and for testing connections."""

from __future__ import annotations

import argparse
import logging
import re
import sys
from collections.abc import Sequence
from decimal import Decimal

from rich.console import Console
from rich.table import Table

from kerfin_engine import institutions, paths, woob_modules
from kerfin_engine.connectors import ConnectorError, Prompt
from kerfin_engine.connectors.woob_connector import WoobConnector, config_prompts
from kerfin_engine.institutions import ConnectorType

console = Console()

REDACTED = "•••"


class TerminalInteraction:
    def ask(self, prompt: Prompt) -> str:
        label = prompt.label
        if prompt.choices:
            label += f" [{'/'.join(prompt.choices)}]"
        if prompt.default:
            label += f" (default: {prompt.default})"
        while True:
            answer = console.input(f"{label}: ", password=prompt.secret).strip()
            answer = answer or (prompt.default or "")
            if prompt.choices and answer not in prompt.choices:
                console.print(f"[red]Choose one of: {', '.join(prompt.choices)}[/red]")
            elif answer and prompt.pattern and not re.match(prompt.pattern, answer):
                console.print(f"[red]Invalid format (expected {prompt.pattern})[/red]")
            elif answer or not prompt.required:
                return answer

    def notify(self, message: str) -> None:
        console.print(f"[yellow]{message}[/yellow]")


def _amount(value: Decimal | None, currency: str | None, redact: bool) -> str:
    if value is None:
        return "-"
    return REDACTED if redact else f"{value:,.2f} {currency or ''}".strip()


def cmd_institutions(_: argparse.Namespace) -> int:
    table = Table("id", "institution", "products", "connector", "status")
    for institution in institutions.CATALOG:
        status = "[green]ready to test[/green]" if institution.implemented else "planned"
        table.add_row(institution.id, institution.name, institution.products, institution.connector, status)
    console.print(table)
    return 0


def cmd_woob_modules(args: argparse.Namespace) -> int:
    modules_dir = paths.woob_modules_dir()
    pinned = woob_modules.pinned_commit()
    if args.install:
        with console.status(f"Downloading Woob modules for commit {pinned[:10]}..."):
            woob_modules.install(modules_dir, pinned)
    installed = woob_modules.installed_commit(modules_dir)
    console.print(f"Woob core commit:    {pinned}")
    console.print(f"Woob modules commit: {installed or '[red]not installed[/red]'} ({modules_dir})")
    if installed != pinned:
        console.print(
            "[yellow]Run `kerfin-engine woob-modules --install` to fetch matching modules.[/yellow]"
        )
        return 1
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    """Log in to one institution and show what we can read. Credentials are never stored."""
    try:
        institution = institutions.get(args.institution)
    except KeyError:
        console.print(
            f"[red]Unknown institution {args.institution!r}; see `kerfin-engine institutions`.[/red]"
        )
        return 2
    if institution.connector is not ConnectorType.WOOB or not institution.implemented:
        console.print(
            f"[yellow]{institution.name}: the {institution.connector} connector is not built yet.[/yellow]"
        )
        return 2

    if args.debug:
        logging.basicConfig(level=logging.DEBUG)
        console.print("[yellow]Debug output can contain personal data: don't share it publicly.[/yellow]")

    settings = dict(institution.settings)
    module = settings.pop("module")
    interaction = TerminalInteraction()
    connector = None
    try:
        params = dict(settings)
        console.print(f"[bold]{institution.name}[/bold]: enter your credentials (they are not saved).")
        for prompt in config_prompts(module, fixed=settings):
            params[prompt.key] = interaction.ask(prompt)

        with console.status("Logging in..."):
            connector = WoobConnector(module, params, interaction)
        accounts = connector.accounts()
        console.print(f"[green]Login OK[/green]: {len(accounts)} account(s) found.")

        for account in accounts:
            console.print()
            number = REDACTED if args.redact else (account.number or "")
            console.rule(f"{account.label} {number}".strip())
            console.print(
                f"kind: {account.kind} ({account.subtype or '?'})   "
                f"balance: {_amount(account.balance, account.currency, args.redact)}   "
                f"opened: {account.opening_date or '-'}"
            )
            holdings = connector.holdings(account.external_id)
            if holdings:
                table = Table("holding", "ISIN", "quantity", "unit value", "valuation")
                for holding in holdings:
                    table.add_row(
                        holding.label,
                        holding.isin or "-",
                        REDACTED if args.redact else str(holding.quantity or "-"),
                        str(holding.unit_value or "-"),
                        _amount(holding.valuation, holding.currency, args.redact),
                    )
                console.print(table)
            if args.transactions:
                transactions = connector.transactions(account.external_id, limit=args.transactions)
                console.print(f"{len(transactions)} recent transaction(s):")
                for transaction in transactions:
                    amount = _amount(transaction.amount, transaction.currency, args.redact)
                    label = REDACTED if args.redact else transaction.label
                    console.print(f"  {transaction.date}  {amount:>16}  {label}")
    except ConnectorError as error:
        console.print(f"[red]Failed: {error.code}[/red] {error.detail}")
        return 1
    finally:
        if connector is not None:
            connector.close()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from kerfin_engine import server

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO, stream=sys.stderr)
    server.serve(args.port, args.watch_stdin)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kerfin-engine")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("institutions", help="list institutions and their connectors").set_defaults(
        handler=cmd_institutions
    )

    modules = commands.add_parser("woob-modules", help="show or install the Woob site modules")
    modules.add_argument("--install", action="store_true", help="download modules matching the Woob core")
    modules.set_defaults(handler=cmd_woob_modules)

    probe = commands.add_parser("probe", help="test the login to one institution")
    probe.add_argument("institution", help="institution id, see `institutions`")
    probe.add_argument("--transactions", type=int, metavar="N", default=0, help="also show N transactions")
    probe.add_argument("--redact", action="store_true", help="hide amounts and labels, to share the output")
    probe.add_argument("--debug", action="store_true", help="verbose Woob logs")
    probe.set_defaults(handler=cmd_probe)

    serve = commands.add_parser("serve", help="run the local API used by the desktop app")
    serve.add_argument("--port", type=int, default=0, help="port on 127.0.0.1 (default: any free port)")
    serve.add_argument("--watch-stdin", action="store_true", help="exit when stdin closes")
    serve.add_argument("--debug", action="store_true", help="verbose logs (may contain personal data)")
    serve.set_defaults(handler=cmd_serve)

    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
