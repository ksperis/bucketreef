/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useId, useRef, type KeyboardEvent } from "react";
import UiBadge from "../ui/UiBadge";
import UiInfoTooltip from "../ui/UiInfoTooltip";
import {
  cx,
  uiCheckboxClass,
  uiDividerClass,
  uiRadioClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../ui/styles";
import type { UiTone } from "../ui/styles";
import "./compactSettings.css";

type SettingsSectionProps = {
  title: string;
  description?: string;
  layout?: "grid" | "stack";
  columns?: 1 | 2;
  presentation?: "default" | "compact";
  children: ReactNode;
};

type SettingsItemProps = {
  title: string;
  help?: ReactNode;
  ariaLabel?: string;
  description?: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  compact?: boolean;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type SettingsSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  onChange: (value: boolean) => void;
};

type SettingsConditionalBadgeProps = {
  visible?: boolean;
  label: string;
  tone?: UiTone;
  className?: string;
};

type SettingsToggleActionProps = SettingsSwitchProps & {
  badge?: SettingsConditionalBadgeProps;
  className?: string;
};

export type SettingsTriStateOption<T extends string> = {
  value: T;
  label: string;
  symbol: ReactNode;
  disabled?: boolean;
  className?: string;
  selectedClassName?: string;
};

type SettingsTriStateSwitchProps<T extends string> = {
  value: T;
  options: readonly [
    SettingsTriStateOption<T>,
    SettingsTriStateOption<T>,
    SettingsTriStateOption<T>,
  ];
  disabled?: boolean;
  ariaLabel: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  onChange: (value: T) => void;
};

type SettingsTriStateActionProps<T extends string> = SettingsTriStateSwitchProps<T> & {
  badge?: SettingsConditionalBadgeProps;
  className?: string;
};

type SettingsChoiceRowProps = {
  title: string;
  type?: "checkbox" | "radio";
  name?: string;
  value?: string;
  ariaLabel?: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
  className?: string;
};

export const SettingsSection = ({
  title,
  description,
  layout = "grid",
  columns = 2,
  presentation = "default",
  children,
}: SettingsSectionProps) => {
  const headingId = useId();
  if (presentation === "compact") {
    return (
      <section aria-labelledby={headingId} className="settings-section-compact">
        <div>
          <h2
            id={headingId}
            className="settings-section-title"
          >
            {title}
          </h2>
          {description && (
            <p className="settings-description mt-1">
              {description}
            </p>
          )}
        </div>
        <div className="min-w-0">{children}</div>
      </section>
    );
  }
  const layoutClass = cx(
    "mt-3 grid",
    layout === "grid" &&
      columns === 2 &&
      "gap-x-6 md:grid-cols-2 md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(2)]:pt-0",
  );

  return (
    <div>
      <p className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>
        {title}
      </p>
      {description && (
        <p className={cx("ui-caption", uiMutedTextClass)}>{description}</p>
      )}
      <div className={layoutClass}>{children}</div>
    </div>
  );
};

export const SettingsItem = ({
  title,
  help,
  ariaLabel,
  description,
  action,
  children,
  className,
  icon,
  status,
  compact,
}: SettingsItemProps) =>
  compact ? (
    <div role={ariaLabel ? "group" : undefined} aria-label={ariaLabel} className={cx("settings-item-compact", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span
            aria-hidden="true"
            className="shrink-0 text-[var(--ui-text-muted)]"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="settings-label">
              {title}
            </h3>
            {help && <UiInfoTooltip label={`${title}: information`} triggerClassName="settings-info-trigger" tooltipClassName="settings-info-tooltip">{help}</UiInfoTooltip>}
            {status}
          </div>
          {description && (
            <div className="settings-item-description">
              {description}
            </div>
          )}
        </div>
      </div>
      {action && <div className="settings-item-action">{action}</div>}
      {children && <div className="min-w-0 sm:col-span-2">{children}</div>}
    </div>
  ) : (
    <div
      className={cx(
        "border-t py-3 text-[var(--ui-text)] first:border-t-0 first:pt-0 last:pb-0",
        uiDividerClass,
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={cx("ui-body font-semibold", uiTitleTextClass)}>
            {title}
          </p>
          {description && (
            <p className={cx("ui-caption", uiMutedTextClass)}>{description}</p>
          )}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );

export const SettingsChoiceRow = ({
  title,
  type = "checkbox",
  name,
  value,
  ariaLabel,
  description,
  checked,
  disabled,
  onChange,
  children,
  className,
}: SettingsChoiceRowProps) => (
  <label
    className={cx(
      "settings-choice flex items-start gap-3 border-t py-3 ui-caption first:border-t-0 first:pt-0 last:pb-0",
      uiDividerClass,
      disabled
        ? "cursor-not-allowed text-[var(--ui-text-muted)] opacity-70"
        : "cursor-pointer text-[var(--ui-text)]",
      className,
    )}
  >
    <input
      type={type}
      name={name}
      value={value}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={`mt-0.5 ${type === "radio" ? uiRadioClass : uiCheckboxClass}`}
    />
    <span className="min-w-0 flex-1">
      <span
        className={cx(
          "block font-semibold",
          disabled ? uiMutedTextClass : uiTitleTextClass,
        )}
      >
        {title}
      </span>
      {description && (
        <span className="block text-[var(--ui-text-muted)]">{description}</span>
      )}
      {children}
    </span>
  </label>
);

export const SettingsSwitch = ({
  checked,
  disabled,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
}: SettingsSwitchProps) => (
  <label
    className={`settings-switch-target relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:min-h-8 lg:min-w-9 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
  >
    <input
      type="checkbox"
      role="switch"
      className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
    <span
      aria-hidden="true"
      className="pointer-events-none relative h-5 w-9 shrink-0 rounded-full bg-[var(--ui-text-muted)] transition-colors peer-checked:bg-primary dark:peer-checked:bg-primary-400 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-700 dark:peer-focus-visible:outline-primary-200 peer-checked:[&>span]:translate-x-4"
    >
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none" />
    </span>
  </label>
);

export const SettingsTriStateSwitch = <T extends string,>({
  value,
  options,
  disabled,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
}: SettingsTriStateSwitchProps<T>) => {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const first = event.key === "Home";
    const last = event.key === "End";
    if (!forward && !backward && !first && !last) return;
    event.preventDefault();

    const enabledIndexes = options
      .map((option, optionIndex) => (!option.disabled ? optionIndex : -1))
      .filter((optionIndex) => optionIndex >= 0);
    if (enabledIndexes.length === 0) return;

    let nextIndex = index;
    if (first) {
      nextIndex = enabledIndexes[0];
    } else if (last) {
      nextIndex = enabledIndexes[enabledIndexes.length - 1];
    } else {
      const currentEnabledIndex = enabledIndexes.indexOf(index);
      const offset = forward ? 1 : -1;
      const start = currentEnabledIndex >= 0 ? currentEnabledIndex : 0;
      nextIndex = enabledIndexes[(start + offset + enabledIndexes.length) % enabledIndexes.length];
    }
    onChange(options[nextIndex].value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled || undefined}
      className={cx(
        "settings-tristate-switch inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-0.5",
        disabled && "opacity-60",
      )}
    >
      {options.map((option, index) => {
        const selected = currentIndex === index;
        const optionDisabled = disabled || option.disabled;
        return (
          <button
            key={option.value}
            ref={(node) => { buttonRefs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            tabIndex={selected ? 0 : -1}
            disabled={optionDisabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => moveSelection(event, index)}
            className={cx(
              "settings-tristate-option inline-flex items-center justify-center rounded-md font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 dark:focus-visible:outline-primary-200 disabled:cursor-not-allowed",
              option.className,
              selected
                ? option.selectedClassName ?? "bg-primary text-white shadow-sm dark:bg-primary-400 dark:text-slate-950"
                : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]",
            )}
          >
            <span aria-hidden="true">{option.symbol}</span>
          </button>
        );
      })}
    </div>
  );
};

export const SettingsConditionalBadge = ({
  visible = false,
  label,
  tone = "warning",
  className,
}: SettingsConditionalBadgeProps) => {
  if (!visible) return null;
  return (
    <UiBadge tone={tone} className={className}>
      {label}
    </UiBadge>
  );
};

export const SettingsToggleAction = ({
  checked,
  disabled,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
  badge,
  className,
}: SettingsToggleActionProps) => (
  <div className={cx("inline-flex items-center gap-2", className)}>
    {badge && (
      <SettingsConditionalBadge
        visible={badge.visible}
        label={badge.label}
        tone={badge.tone}
        className={badge.className}
      />
    )}
    <SettingsSwitch
      checked={checked}
      disabled={disabled}
      ariaLabel={ariaLabel}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
      onChange={onChange}
    />
  </div>
);

export const SettingsTriStateAction = <T extends string,>({
  value,
  options,
  disabled,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
  badge,
  className,
}: SettingsTriStateActionProps<T>) => (
  <div className={cx("inline-flex items-center gap-2", className)}>
    {badge && (
      <SettingsConditionalBadge
        visible={badge.visible}
        label={badge.label}
        tone={badge.tone}
        className={badge.className}
      />
    )}
    <SettingsTriStateSwitch
      value={value}
      options={options}
      disabled={disabled}
      ariaLabel={ariaLabel}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
      onChange={onChange}
    />
  </div>
);
