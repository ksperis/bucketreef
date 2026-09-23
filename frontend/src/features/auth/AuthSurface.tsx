/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import { cx } from "../../components/ui/styles";

export function AuthBrandBackdrop({ radial = false }: { radial?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute -left-24 top-[-7rem] h-80 w-80 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="auth-brand-glow-coral absolute -right-24 bottom-[-7rem] h-96 w-96 rounded-full blur-3xl" />
      {radial ? <div className="auth-brand-radial absolute inset-0" /> : null}
    </div>
  );
}

export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        "relative w-full rounded-3xl border border-white/70 bg-white/95 text-slate-900 shadow-2xl",
        className,
      )}
    >
      {children}
    </section>
  );
}

type AuthCenteredPageProps = {
  children: ReactNode;
  className?: string;
  radial?: boolean;
};

export function AuthCenteredPage({ children, className, radial = false }: AuthCenteredPageProps) {
  return (
    <div
      className={cx(
        "relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4",
        className,
      )}
    >
      <AuthBrandBackdrop radial={radial} />
      {children}
    </div>
  );
}
