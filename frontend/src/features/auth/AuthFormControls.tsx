/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";

import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx } from "../../components/ui/styles";

const authFieldLabelClass =
  "normal-case tracking-normal ui-body font-medium text-slate-700";
const authControlClass =
  "mt-1 rounded-xl border-slate-200/90 bg-white/90 px-3 py-2.5 text-slate-800 shadow-sm focus:border-primary focus:ring-primary/30";

export function AuthInput({ className, labelClassName, ...props }: ComponentProps<typeof UiInput>) {
  return (
    <UiInput
      {...props}
      labelClassName={cx(authFieldLabelClass, labelClassName)}
      className={cx(authControlClass, className)}
    />
  );
}

export function AuthSelect({ className, labelClassName, ...props }: ComponentProps<typeof UiSelect>) {
  return (
    <UiSelect
      {...props}
      labelClassName={cx(authFieldLabelClass, labelClassName)}
      className={cx(authControlClass, className)}
    />
  );
}

type AuthButtonProps = ComponentProps<typeof UiButton> & {
  presentation?: "primary" | "provider";
};

export function AuthButton({ presentation = "primary", className, ...props }: AuthButtonProps) {
  return (
    <UiButton
      {...props}
      variant={presentation === "provider" ? "secondary" : "primary"}
      className={cx(
        "w-full rounded-xl py-2.5 ui-body",
        presentation === "provider" &&
          "border-slate-200/90 bg-white font-medium text-slate-700 hover:border-primary hover:text-primary-700",
        className,
      )}
    />
  );
}
