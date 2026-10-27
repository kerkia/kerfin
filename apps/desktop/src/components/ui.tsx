import type { Prompt } from "@kerfin/core";
import { useEffect, useRef } from "react";

import { t } from "../i18n";

/** A modal using the native <dialog>, so focus and Escape behave as expected. */
export function Dialog({
  open,
  onClose,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && <div className="dialog-body">{children}</div>}
    </dialog>
  );
}

export function promptError(prompt: Prompt, value: string): string | null {
  if (!value) return prompt.required ? t("add.required") : null;
  if (prompt.pattern && !new RegExp(prompt.pattern).test(value)) return t("add.invalidFormat");
  return null;
}

/** An input for a value the engine asks for: login field, SMS code, choice... */
export function PromptInput({
  prompt,
  value,
  onChange,
  showError,
  autoFocus,
}: {
  prompt: Prompt;
  value: string;
  onChange: (value: string) => void;
  showError: boolean;
  autoFocus?: boolean;
}) {
  const id = `prompt-${prompt.key}`;
  const error = showError ? promptError(prompt, value) : null;
  return (
    <div className="field">
      <label htmlFor={id}>{prompt.label}</label>
      {prompt.choices.length > 0 ? (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {!prompt.required && <option value="" />}
          {prompt.choices.map((choice) => (
            <option key={choice}>{choice}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="input"
          type={prompt.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && <span className="error-text small">{error}</span>}
    </div>
  );
}

export function initialValues(prompts: Prompt[]): Record<string, string> {
  return Object.fromEntries(prompts.map((p) => [p.key, p.default ?? (p.choices.length ? p.choices[0]! : "")]));
}
