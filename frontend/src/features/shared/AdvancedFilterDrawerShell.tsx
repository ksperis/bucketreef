/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import UiButton from "../../components/ui/UiButton";
import UiDrawer, { UiDrawerBody, UiDrawerFooter, UiDrawerHeader } from "../../components/ui/UiDrawer";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";

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
    <UiDrawer
      ariaLabelledBy={titleId}
      onClose={onClose}
      rootClassName="inset-x-0 bottom-0 top-14"
      showBackdrop
      backdropLabel={closeAriaLabel}
      surfaceClassName={cx("w-full max-w-3xl", className)}
    >
        <UiDrawerHeader>
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
        </UiDrawerHeader>
        <UiDrawerBody>{children}</UiDrawerBody>
        {footer ? <UiDrawerFooter>{footer}</UiDrawerFooter> : null}
    </UiDrawer>
  );
}
