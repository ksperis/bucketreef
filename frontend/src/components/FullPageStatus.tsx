/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiButton, { UiButtonLink } from "./ui/UiButton";
import { cx, uiCardClass } from "./ui/styles";

type FullPageStatusAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
};

type FullPageStatusProps = {
  title: string;
  description: ReactNode;
  primaryAction?: FullPageStatusAction;
  secondaryAction?: FullPageStatusAction;
  children?: ReactNode;
};

function renderAction(action: FullPageStatusAction) {
  const variant = action.variant ?? "secondary";

  if (action.to) {
    return (
      <UiButtonLink key={action.label} to={action.to} variant={variant} className="min-w-36">
        {action.label}
      </UiButtonLink>
    );
  }

  return (
    <UiButton key={action.label} onClick={action.onClick} variant={variant} className="min-w-36">
      {action.label}
    </UiButton>
  );
}

export default function FullPageStatus({
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
}: FullPageStatusProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <section className={cx(uiCardClass, "w-full max-w-2xl px-6 py-8 text-center sm:px-8")}>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <div className="mt-3 ui-body text-slate-600 dark:text-slate-300">{description}</div>
        {children ? <div className="mt-4">{children}</div> : null}
        {primaryAction || secondaryAction ? (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {primaryAction ? renderAction(primaryAction) : null}
            {secondaryAction ? renderAction({ ...secondaryAction, variant: secondaryAction.variant ?? "ghost" }) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
