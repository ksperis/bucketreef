/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState, type ReactNode } from "react";

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
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = !disabled && !dismissed && (hovered || focused);

  return (
    <span
      className="shell-utility-hint"
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => { if (event.key === "Escape") setDismissed(true); }}
    >
      {children}
      {visible && <span className="shell-utility-tooltip" aria-hidden="true">{label}</span>}
    </span>
  );
}
