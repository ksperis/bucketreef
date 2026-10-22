/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useRef, useState, type ReactNode } from "react";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";

export default function TopbarUtilityHint({
  label,
  disabled = false,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = !disabled && !dismissed && (hovered || focused);

  return (
    <span
      ref={anchorRef}
      className="shell-utility-hint"
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && visible) {
          event.preventDefault();
          event.stopPropagation();
          setDismissed(true);
        }
      }}
    >
      {children}
      <AnchoredPortalMenu open={visible} anchorRef={anchorRef} placement="bottom-center" minWidth={0} className="!z-[47] max-lg:!z-[45]">
        <span className="shell-utility-tooltip" aria-hidden="true">{label}</span>
      </AnchoredPortalMenu>
    </span>
  );
}
