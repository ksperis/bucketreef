/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiSegmentedControl from "../../../components/ui/UiSegmentedControl";
import { useManagerI18n } from "../managerI18n";

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
  const { text } = useManagerI18n();
  return (
    <UiSegmentedControl
      ariaLabel={text("Editor mode")}
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ ...option, disabled }))}
    />
  );
}
