/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, type ReactNode } from "react";

import UiDrawer, { UiDrawerBody, UiDrawerCloseButton, UiDrawerFooter, UiDrawerHeader } from "../../components/ui/UiDrawer";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";

type AdvancedFilterDrawerShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
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
      workspace
      showBackdrop
      backdropLabel={closeAriaLabel}
      surfaceClassName={cx("w-full lg:max-w-3xl", className)}
    >
        <UiDrawerHeader>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className={cx("ui-subtitle", uiTitleTextClass)}>
                {title}
              </h2>
              {subtitle ? <p className={cx("mt-1 ui-caption", uiMutedTextClass)}>{subtitle}</p> : null}
              {badges ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div> : null}
            </div>
            <UiDrawerCloseButton label={closeLabel} onClose={onClose} />
          </div>
        </UiDrawerHeader>
        <UiDrawerBody>{children}</UiDrawerBody>
        {footer ? <UiDrawerFooter>{footer}</UiDrawerFooter> : null}
    </UiDrawer>
  );
}
