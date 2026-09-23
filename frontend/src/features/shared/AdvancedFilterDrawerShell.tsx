/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import UiButton from "../../components/ui/UiButton";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import {
  advancedFilterBackdropClass,
  advancedFilterBodyClass,
  advancedFilterDrawerClass,
  advancedFilterFooterClass,
  advancedFilterHeaderClass,
  advancedFilterRootClass,
} from "./advancedFilterShared";

type AdvancedFilterDrawerShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: ReactNode;
  closeAriaLabel?: string;
  onClose: () => void;
  className?: string;
};

export default function AdvancedFilterDrawerShell({
  title,
  subtitle,
  badges,
  children,
  footer,
  closeLabel = "Close",
  closeAriaLabel = "Close advanced filter drawer",
  onClose,
  className,
}: AdvancedFilterDrawerShellProps) {
  const titleId = useId();

  return (
    <div className={advancedFilterRootClass}>
      <button
        type="button"
        onClick={onClose}
        className={advancedFilterBackdropClass}
        aria-label={closeAriaLabel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(advancedFilterDrawerClass, className)}
      >
        <div className={advancedFilterHeaderClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p id={titleId} className={cx("ui-body font-semibold", uiTitleTextClass)}>
                {title}
              </p>
              {subtitle ? <p className={cx("ui-caption", uiMutedTextClass)}>{subtitle}</p> : null}
              {badges ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div> : null}
            </div>
            <UiButton size="sm" variant="secondary" onClick={onClose}>
              {closeLabel}
            </UiButton>
          </div>
        </div>
        <div className={advancedFilterBodyClass}>{children}</div>
        {footer ? <div className={advancedFilterFooterClass}>{footer}</div> : null}
      </div>
    </div>
  );
}
