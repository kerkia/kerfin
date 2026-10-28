"""Kerfin-side fixes to Woob modules, for website behaviour the pinned Woob commit doesn't handle.

Drop a fix once Woob handles the case itself.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlsplit

from woob.browser import URL
from woob.browser.pages import HTMLPage
from woob.exceptions import BrowserIncorrectPassword, BrowserPasswordExpired
from woob.tools.backend import Module

from kerfin_engine.connectors.base import InteractionHandler

# Settings a module declares but doesn't use at the pinned commit: not worth asking for.
UNUSED_SETTINGS: dict[str, set[str]] = {
    # BoursoBank: with several identities (e.g. personal and professional), the first is used.
    "boursorama": {"identity"},
}


def apply(module: str, backend: Module, interaction: InteractionHandler | None) -> None:
    if module == "boursorama" and interaction is not None:
        backend.BROWSER = _boursobank_browser(backend.BROWSER, interaction)
    elif module == "spirica":
        backend.BROWSER = _spirica_browser(backend.BROWSER)
    elif module == "fortuneo":
        backend.BROWSER = _fortuneo_browser(backend.BROWSER)


def _fortuneo_browser(base: type[Any]) -> type[Any]:
    """Fortuneo refuses a login by redirecting with an error, where Woob expects a code."""

    class FortuneoBrowser(base):  # type: ignore[misc, valid-type]
        def request_authorization(self) -> None:
            try:
                super().request_authorization()
            except KeyError:
                location = self.response.headers.get("Location", "")
                params = dict(parse_qsl(urlsplit(location).fragment))
                if params.get("error_description") == "authentication-failed":
                    raise BrowserIncorrectPassword(params["error_description"]) from None
                raise

    return FortuneoBrowser


class _PasswordChangePage(HTMLPage):
    def on_load(self) -> None:
        raise BrowserPasswordExpired(
            locale="fr-FR", message="Le site demande de changer le mot de passe : connectez-vous sur le site."
        )


def _spirica_browser(base: type[Any]) -> type[Any]:
    """Sylvéa (Spirica) renamed its login button, which the website needs in the form data, and
    may ask for a new password after logging in, a page Woob doesn't know."""

    class LoginPage(base.login.klass):  # type: ignore[misc, name-defined]
        def login(self, login: str, password: str) -> None:
            form = self.get_form(
                '//form[@id="loginForm"]', submit='//form[@id="loginForm"]//input[@type="submit"]'
            )
            form["loginForm:name"] = login
            form["loginForm:password"] = password
            form.submit()

    class SpiricaBrowser(base):  # type: ignore[misc, valid-type]
        login = URL(*base.login.urls, LoginPage)
        password_change = URL(r"/securite/.*changePasswd\.xhtml.*", _PasswordChangePage)

    return SpiricaBrowser


def _boursobank_browser(base: type[Any], interaction: InteractionHandler) -> type[Any]:
    """BoursoBank's "vérification de proximité".

    While the user validates a login in the BoursoBank app, the website may show a QR code
    that the app must scan, to prove the phone is next to the computer. Woob gives up at that
    point; here the code is shown to the user, and the wait for the validation goes on.
    """

    class BoursoBankBrowser(base):  # type: ignore[misc, valid-type]
        def check_twofa_status(self, token: str | None = None) -> None:
            super().check_twofa_status(token)
            doc = self.page.doc
            code = doc.get("qrcode") if isinstance(doc, dict) else None
            if isinstance(code, str) and code:
                interaction.show_qr_code(code)
                # Woob stops polling when it sees a QR code; let it carry on.
                doc["qrcode"] = False

        def handle_polling(self) -> None:
            try:
                super().handle_polling()
            finally:
                interaction.show_qr_code(None)

    return BoursoBankBrowser
