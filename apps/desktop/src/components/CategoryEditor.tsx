// The user's spending categories: Kerfin's list to start with, renamed, extended or trimmed.
import { DEFAULT_CATEGORIES, REQUIRED_CATEGORIES, categoryKey } from "@kerfin/core";
import type { CategoryDef, CategoryKind } from "@kerfin/core";
import { useEffect, useState } from "react";

import { engine } from "../engine";
import { categoryName, t } from "../i18n";
import { Dialog } from "./ui";

const KINDS: CategoryKind[] = ["spending", "income", "excluded"];

export function CategoryEditor({
  open,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  categories: CategoryDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [list, setList] = useState(categories);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) setList(categories);
  }, [open, categories]);

  const change = (key: string, values: Partial<CategoryDef>) =>
    setList((all) => all.map((c) => (c.key === key ? { ...c, ...values } : c)));

  function add() {
    if (!name.trim()) return;
    setList((all) => [...all.filter((c) => c.key !== "other"), { key: categoryKey(name, all), kind: "spending", label: name.trim() }, ...all.filter((c) => c.key === "other")]);
    setName("");
  }

  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      // A name left as Kerfin's own stays Kerfin's (and follows its wording).
      await engine.setCategories(
        list.map((c) => ({ ...c, label: c.label?.trim() && c.label.trim() !== categoryName({ key: c.key }) ? c.label.trim() : null })),
      );
      onSaved();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} wide>
      <h2 style={{ margin: 0 }}>{t("categories.title")}</h2>
      <p className="secondary" style={{ margin: 0 }}>
        {t("categories.help")}
      </p>
      <div className="table-scroll" style={{ maxHeight: "55vh" }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("categories.name")}</th>
              <th>{t("categories.kind")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((category) => (
              <tr key={category.key}>
                <td>
                  <input
                    className="input compact"
                    aria-label={t("categories.name")}
                    value={category.label ?? categoryName({ key: category.key })}
                    maxLength={60}
                    onChange={(e) => change(category.key, { label: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="input compact"
                    aria-label={t("categories.kind")}
                    value={category.kind}
                    onChange={(e) => change(category.key, { kind: e.target.value as CategoryKind })}
                  >
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`categories.kind.${kind}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="right">
                  <button
                    className="btn small ghost danger"
                    disabled={REQUIRED_CATEGORIES.has(category.key)}
                    title={REQUIRED_CATEGORIES.has(category.key) ? t("categories.required") : undefined}
                    onClick={() => setList((all) => all.filter((c) => c.key !== category.key))}
                  >
                    {t("categories.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input compact" placeholder={t("categories.new")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button className="btn small" type="submit" disabled={!name.trim()}>
          {t("categories.add")}
        </button>
      </form>
      {failed && <div className="error-text">{t("categories.failed")}</div>}
      <div className="dialog-actions">
        <button className="btn ghost" style={{ marginRight: "auto" }} onClick={() => setList(DEFAULT_CATEGORIES)}>
          {t("categories.reset")}
        </button>
        <button className="btn" onClick={onClose}>
          {t("add.cancel")}
        </button>
        <button className="btn primary" disabled={busy || list.some((c) => c.label !== undefined && c.label !== null && !c.label.trim())} onClick={() => void save()}>
          {t("categories.save")}
        </button>
      </div>
    </Dialog>
  );
}
