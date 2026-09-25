/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";

import UiField from "../ui/UiField";
import { cx } from "../ui/styles";
import { SettingsButton } from "./SettingsControls";
import "./settingsJsonEditor.css";

type JsonSyntaxState =
  | { kind: "empty" }
  | { kind: "valid"; parsed: unknown }
  | { kind: "invalid"; message: string };

type SettingsJsonEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  rows?: number;
  id?: string;
  className?: string;
  onValidityChange?: (valid: boolean) => void;
};

const JSON_TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

function syntaxState(value: string): JsonSyntaxState {
  if (!value.trim()) return { kind: "empty" };
  try {
    return { kind: "valid", parsed: JSON.parse(value) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON syntax.";
    return { kind: "invalid", message: `Invalid JSON: ${message}` };
  }
}

function tokenClass(value: string, source: string, end: number): string {
  if (value.startsWith('"')) {
    return /^\s*:/.test(source.slice(end))
      ? "settings-json-token-key"
      : "settings-json-token-string";
  }
  if (value === "true" || value === "false") return "settings-json-token-boolean";
  if (value === "null") return "settings-json-token-null";
  return "settings-json-token-number";
}

function highlightedJson(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  JSON_TOKEN_PATTERN.lastIndex = 0;
  while ((match = JSON_TOKEN_PATTERN.exec(value)) !== null) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    const end = match.index + token.length;
    nodes.push(
      <span key={`${match.index}-${end}`} className={tokenClass(token, value, end)} data-json-token>
        {token}
      </span>,
    );
    cursor = end;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function selectedLineRange(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = value.indexOf("\n", end);
  return { lineStart, lineEnd: nextNewline === -1 ? value.length : nextNewline };
}

export default function SettingsJsonEditor({
  value,
  onChange,
  label,
  hint,
  error,
  placeholder,
  disabled = false,
  readOnly = false,
  rows = 12,
  id,
  className,
  onValidityChange,
}: SettingsJsonEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const state = useMemo(() => syntaxState(value), [value]);
  const syntaxError = state.kind === "invalid" ? state.message : undefined;
  const displayError = error ?? syntaxError;

  useEffect(() => {
    onValidityChange?.(state.kind === "valid");
  }, [onValidityChange, state.kind]);

  const scheduleSelection = (start: number, end = start) => {
    window.requestAnimationFrame(() => textareaRef.current?.setSelectionRange(start, end));
  };

  const updateValueAndSelection = (nextValue: string, start: number, end = start) => {
    onChange?.(nextValue);
    scheduleSelection(start, end);
  };

  const handleTab = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || disabled || readOnly || !onChange) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = textarea;

    if (!event.shiftKey && start === end) {
      const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
      updateValueAndSelection(nextValue, start + 2);
      return;
    }

    const { lineStart, lineEnd } = selectedLineRange(value, start, end);
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");

    if (!event.shiftKey) {
      const indented = lines.map((line) => `  ${line}`).join("\n");
      const nextValue = `${value.slice(0, lineStart)}${indented}${value.slice(lineEnd)}`;
      updateValueAndSelection(nextValue, start + 2, end + lines.length * 2);
      return;
    }

    let removedBeforeStart = 0;
    let removedTotal = 0;
    let offset = lineStart;
    const dedented = lines.map((line) => {
      const removed = line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;
      if (offset < start) removedBeforeStart += Math.min(removed, Math.max(0, start - offset));
      removedTotal += removed;
      offset += line.length + 1;
      return line.slice(removed);
    }).join("\n");
    const nextValue = `${value.slice(0, lineStart)}${dedented}${value.slice(lineEnd)}`;
    updateValueAndSelection(
      nextValue,
      Math.max(lineStart, start - removedBeforeStart),
      Math.max(lineStart, end - removedTotal),
    );
  };

  const formatJson = () => {
    if (state.kind !== "valid" || disabled || readOnly || !onChange) return;
    const formatted = JSON.stringify(state.parsed, null, 2);
    onChange(formatted);
    scheduleSelection(formatted.length);
  };

  const statusText = state.kind === "valid"
    ? "Valid JSON"
    : state.kind === "empty"
      ? "Empty JSON document"
      : "JSON syntax error";

  return (
    <UiField
      label={label}
      hint={hint}
      error={displayError}
      htmlFor={id}
      labelClassName="settings-label"
    >
      {({ id: resolvedId, describedBy, invalid }) => (
        <>
          <div className="settings-json-editor font-mono settings-body">
            <pre
              ref={highlightRef}
              aria-hidden="true"
              className={cx("settings-json-highlight", disabled && "opacity-60")}
            >
              {value ? highlightedJson(value) : " "}
            </pre>
            <textarea
              id={resolvedId}
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange?.(event.target.value)}
              onKeyDown={handleTab}
              onScroll={(event) => {
                if (!highlightRef.current) return;
                highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
              }}
              rows={rows}
              placeholder={placeholder}
              disabled={disabled}
              readOnly={readOnly}
              spellCheck={false}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className={cx("ui-control settings-control settings-json-input", className)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              aria-live="polite"
              className={cx(
                "settings-field-help",
                state.kind === "valid"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-[var(--ui-text-muted)]",
              )}
            >
              {statusText}
            </span>
            {!readOnly ? (
              <SettingsButton
                type="button"
                variant="secondary"
                onClick={formatJson}
                disabled={disabled || state.kind !== "valid" || !onChange}
              >
                Format JSON
              </SettingsButton>
            ) : null}
          </div>
        </>
      )}
    </UiField>
  );
}
