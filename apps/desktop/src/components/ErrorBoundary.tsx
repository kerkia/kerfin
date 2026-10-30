// A page that fails to draw shows what went wrong instead of taking the whole window down;
// the navigation stays, and "Try again" draws the page anew.
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { t } from "../i18n";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="card" role="alert">
        <h2 style={{ marginTop: 0 }}>{t("crash.title")}</h2>
        <p className="secondary">{t("crash.help")}</p>
        <pre className="muted small crash-detail">{error.message}</pre>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          {t("crash.retry")}
        </button>
      </section>
    );
  }
}
