/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SettingsButton } from "../../../components/settings/SettingsControls";

type BucketFeatureModeOption<T extends string> = {
  value: T;
  label: string;
};

type BucketFeatureModeToggleProps<T extends string> = {
  value: T;
  options: Array<BucketFeatureModeOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export default function BucketFeatureModeToggle<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: BucketFeatureModeToggleProps<T>) {
  return (
    <div role="group" aria-label="Editor mode" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <SettingsButton
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          variant={value === option.value ? "primary" : "secondary"}
          aria-pressed={value === option.value}
          disabled={disabled}
        >
          {option.label}
        </SettingsButton>
      ))}
    </div>
  );
}
