"""Which connector serves which institution, and the fields a user fills in to connect."""

from __future__ import annotations

from kerfin_engine.connectors import demo
from kerfin_engine.connectors.base import Connector, ConnectorError, ErrorCode, InteractionHandler, Prompt
from kerfin_engine.institutions import ConnectorType, Institution


def _woob_settings(institution: Institution) -> tuple[str, dict[str, str]]:
    settings = dict(institution.settings)
    return settings.pop("module"), settings


def fields(institution: Institution) -> list[Prompt]:
    if institution.connector is ConnectorType.DEMO:
        return list(demo.FIELDS)
    if institution.connector is ConnectorType.WOOB:
        from kerfin_engine.connectors.woob_connector import config_prompts

        module, fixed = _woob_settings(institution)
        return config_prompts(module, fixed=fixed)
    raise ConnectorError(ErrorCode.CONNECTOR_UNAVAILABLE, f"No connector yet for {institution.name}")


def open_connector(
    institution: Institution, params: dict[str, str], interaction: InteractionHandler | None
) -> Connector:
    if institution.connector is ConnectorType.DEMO:
        return demo.DemoConnector(params, interaction)
    if institution.connector is ConnectorType.WOOB:
        # Imported lazily: loading Woob takes a moment and isn't needed to start the app.
        from kerfin_engine.connectors.woob_connector import WoobConnector

        module, fixed = _woob_settings(institution)
        return WoobConnector(module, {**fixed, **params}, interaction)
    raise ConnectorError(ErrorCode.CONNECTOR_UNAVAILABLE, f"No connector yet for {institution.name}")
