/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import AnchoredPortalMenu from "../ui/AnchoredPortalMenu";
import UiInput from "../ui/UiInput";
import { cx, uiMenuClass, uiMenuItemClass } from "../ui/styles";
import { SettingsButton } from "./SettingsControls";

export type SettingsAutocompleteSuggestion = {
  value: string;
  label?: string;
  description?: string;
  source?: string;
};

export type SettingsSuggestionSource = {
  suggestions?: SettingsAutocompleteSuggestion[];
  loadSuggestions?: (query: string) => Promise<SettingsAutocompleteSuggestion[]>;
};

type SettingsAutocompleteProps = Omit<
  ComponentProps<typeof UiInput>,
  "onChange" | "onKeyDown" | "value"
> &
  SettingsSuggestionSource & {
    value: string;
    onChange: (value: string) => void;
    onCommit?: (value: string) => void;
    onSelectSuggestion?: (suggestion: SettingsAutocompleteSuggestion) => void;
    debounceMs?: number;
    maxSuggestions?: number;
    loadingLabel?: string;
  };

const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_MAX_SUGGESTIONS = 20;

function suggestionSearchText(suggestion: SettingsAutocompleteSuggestion): string {
  return [suggestion.value, suggestion.label, suggestion.description, suggestion.source]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function mergeSuggestions(
  query: string,
  local: SettingsAutocompleteSuggestion[],
  remote: SettingsAutocompleteSuggestion[],
  maxSuggestions: number,
): SettingsAutocompleteSuggestion[] {
  const normalizedQuery = query.toLocaleLowerCase();
  const seen = new Set<string>();
  const result: SettingsAutocompleteSuggestion[] = [];
  for (const suggestion of [...local, ...remote]) {
    if (seen.has(suggestion.value)) continue;
    if (normalizedQuery && !suggestionSearchText(suggestion).includes(normalizedQuery)) continue;
    seen.add(suggestion.value);
    result.push(suggestion);
    if (result.length >= maxSuggestions) break;
  }
  return result;
}

export function SettingsAutocomplete({
  value,
  onChange,
  onCommit,
  onSelectSuggestion,
  suggestions = [],
  loadSuggestions,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
  loadingLabel = "Loading suggestions...",
  className = "",
  labelClassName,
  onFocus,
  onBlur,
  ...inputProps
}: SettingsAutocompleteProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const [focused, setFocused] = useState(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<SettingsAutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const visibleSuggestions = useMemo(
    () => mergeSuggestions(value, suggestions, remoteSuggestions, maxSuggestions),
    [maxSuggestions, remoteSuggestions, suggestions, value],
  );
  const menuOpen = focused && (loading || visibleSuggestions.length > 0);

  useEffect(() => {
    if (!focused || !loadSuggestions) {
      requestIdRef.current += 1;
      setRemoteSuggestions([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    const timeoutId = window.setTimeout(() => {
      loadSuggestions(value)
        .then((nextSuggestions) => {
          if (requestIdRef.current !== requestId) return;
          setRemoteSuggestions(nextSuggestions);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setRemoteSuggestions([]);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, debounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [debounceMs, focused, loadSuggestions, value]);

  useEffect(() => {
    if (!menuOpen || visibleSuggestions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex >= visibleSuggestions.length) {
      setActiveIndex(visibleSuggestions.length - 1);
    }
  }, [activeIndex, menuOpen, visibleSuggestions.length]);

  const selectSuggestion = useCallback(
    (suggestion: SettingsAutocompleteSuggestion) => {
      onChange(suggestion.value);
      onSelectSuggestion?.(suggestion);
      setActiveIndex(-1);
      setFocused(false);
    },
    [onChange, onSelectSuggestion],
  );

  return (
    <>
      <UiInput
        {...inputProps}
        ref={inputRef}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? listboxId : undefined}
        aria-activedescendant={
          menuOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        className={`settings-control ${className}`}
        labelClassName={labelClassName ? `settings-label ${labelClassName}` : "settings-label"}
        onChange={(event) => {
          onChange(event.target.value);
          setFocused(true);
          setActiveIndex(-1);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            if (visibleSuggestions.length === 0) return;
            event.preventDefault();
            setFocused(true);
            setActiveIndex((current) =>
              current < visibleSuggestions.length - 1 ? current + 1 : 0,
            );
            return;
          }
          if (event.key === "ArrowUp") {
            if (visibleSuggestions.length === 0) return;
            event.preventDefault();
            setFocused(true);
            setActiveIndex((current) =>
              current > 0 ? current - 1 : visibleSuggestions.length - 1,
            );
            return;
          }
          if ((event.key === "Enter" || event.key === "Tab") && activeIndex >= 0) {
            const suggestion = visibleSuggestions[activeIndex];
            if (!suggestion) return;
            if (event.key === "Enter") event.preventDefault();
            selectSuggestion(suggestion);
            return;
          }
          if (event.key === "Enter" && onCommit) {
            event.preventDefault();
            onCommit(value);
            return;
          }
          if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            setFocused(false);
            setActiveIndex(-1);
          }
        }}
      />

      <AnchoredPortalMenu
        open={menuOpen}
        anchorRef={inputRef}
        placement="bottom-start"
        minWidth="anchor"
        className={cx(uiMenuClass, "max-h-64 overflow-y-auto p-1.5 ui-caption")}
      >
        <div id={listboxId} role="listbox" aria-label="Suggestions">
          {visibleSuggestions.map((suggestion, index) => {
            const active = index === activeIndex;
            return (
              <button
                id={`${listboxId}-option-${index}`}
                key={suggestion.value}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectSuggestion(suggestion);
                }}
                className={cx(
                  uiMenuItemClass,
                  "flex w-full items-start gap-2 py-2 text-left",
                  active
                    ? "bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                    : "text-slate-700 dark:text-slate-200",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-all font-semibold">
                    {suggestion.label ?? suggestion.value}
                  </span>
                  {suggestion.label && suggestion.label !== suggestion.value ? (
                    <span className="mt-0.5 block break-all settings-description">
                      {suggestion.value}
                    </span>
                  ) : null}
                  {suggestion.description ? (
                    <span className="mt-0.5 block settings-description">
                      {suggestion.description}
                    </span>
                  ) : null}
                </span>
                {suggestion.source ? (
                  <span className="shrink-0 ui-caption uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {suggestion.source}
                  </span>
                ) : null}
              </button>
            );
          })}
          {loading ? (
            <div className="px-2 py-1.5 text-slate-500 dark:text-slate-300" role="status">
              {loadingLabel}
            </div>
          ) : null}
        </div>
      </AnchoredPortalMenu>
    </>
  );
}

type SettingsMultiValueAutocompleteProps = SettingsSuggestionSource & {
  label: ReactNode;
  values: string[];
  onChange: (values: string[]) => void;
  itemLabel: string;
  inputLabel?: string;
  description?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  debounceMs?: number;
  maxSuggestions?: number;
  emptyText?: string;
};

export function SettingsMultiValueAutocomplete({
  label,
  values,
  onChange,
  itemLabel,
  inputLabel = `Add ${itemLabel}`,
  description,
  placeholder,
  disabled,
  suggestions,
  loadSuggestions,
  debounceMs,
  maxSuggestions,
  emptyText = "None configured.",
}: SettingsMultiValueAutocompleteProps) {
  const [draft, setDraft] = useState("");

  const addValue = useCallback(
    (candidate: string) => {
      const normalized = candidate.trim();
      if (!normalized || values.includes(normalized)) {
        setDraft("");
        return;
      }
      onChange([...values, normalized]);
      setDraft("");
    },
    [onChange, values],
  );

  return (
    <div className="space-y-2">
      <div>
        <p className="settings-label">{label}</p>
        {description ? <p className="settings-description mt-1">{description}</p> : null}
      </div>

      {values.length === 0 ? (
        <p className="settings-description">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {values.map((value, index) => (
            <div
              key={`${value}-${index}`}
              className="flex min-w-0 items-center gap-2 rounded-md border border-[color:var(--ui-border-soft)] px-2 py-1.5"
            >
              <code className="min-w-0 flex-1 break-all ui-caption">{value}</code>
              <SettingsButton
                type="button"
                variant="ghost"
                onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}
                disabled={disabled}
                aria-label={`Remove ${itemLabel} ${value}`}
              >
                Remove
              </SettingsButton>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <SettingsAutocomplete
          label={inputLabel}
          value={draft}
          onChange={setDraft}
          onCommit={addValue}
          onSelectSuggestion={(suggestion) => addValue(suggestion.value)}
          onBlur={() => addValue(draft)}
          suggestions={suggestions}
          loadSuggestions={loadSuggestions}
          debounceMs={debounceMs}
          maxSuggestions={maxSuggestions}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
        />
        <SettingsButton
          type="button"
          variant="secondary"
          onClick={() => addValue(draft)}
          disabled={disabled || !draft.trim()}
        >
          Add
        </SettingsButton>
      </div>
    </div>
  );
}
