/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useId } from "react";
import UiBadge from "../ui/UiBadge";
import {
  cx,
  uiCheckboxClass,
  uiDividerClass,
  uiInputClass,
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

type SettingsChoiceRowProps = {
  title: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
  className?: string;
};

export const settingsInputClassName = uiInputClass;
export const settingsTextareaClassName = cx(uiInputClass, "min-h-[96px]");
export const settingsLabelClassName = cx(
  "ui-caption font-semibold",
  uiTitleTextClass,
);
export const settingsHelperClassName = cx("mt-1 ui-caption", uiMutedTextClass);

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
            className="text-base font-semibold text-[var(--ui-text)]"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[13px] leading-5 text-[var(--ui-text-muted)]">
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
  description,
  action,
  children,
  className,
  icon,
  status,
  compact,
}: SettingsItemProps) =>
  compact ? (
    <div className={cx("settings-item-compact", className)}>
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
            <h3 className="text-sm font-semibold text-[var(--ui-text)]">
              {title}
            </h3>
            {status}
          </div>
          {description && (
            <div className="mt-0.5 break-words text-[13px] leading-5 text-[var(--ui-text-muted)]">
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
  description,
  checked,
  disabled,
  onChange,
  children,
  className,
}: SettingsChoiceRowProps) => (
  <label
    className={cx(
      "flex items-start gap-3 border-t py-3 ui-caption first:border-t-0 first:pt-0 last:pb-0",
      uiDividerClass,
      disabled
        ? "cursor-not-allowed text-[var(--ui-text-muted)] opacity-70"
        : "cursor-pointer text-[var(--ui-text)]",
      className,
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={`mt-0.5 ${settingsCheckboxClassName}`}
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
    className={`relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:min-h-8 lg:min-w-9 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
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

export const settingsCheckboxClassName = uiCheckboxClass;
