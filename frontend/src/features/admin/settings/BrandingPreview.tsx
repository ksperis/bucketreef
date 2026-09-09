/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { CSSProperties } from "react";
import { useTheme } from "../../../components/theme";
import { generatePrimaryScale } from "../../../components/ui/brandingRuntime";
import UiBadge from "../../../components/ui/UiBadge";
import { SettingsButton } from "../../../components/settings/SettingsControls";

export default function BrandingPreview({ color }: { color: string }) {
  const { theme } = useTheme();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  const scale = generatePrimaryScale(color, theme);
  const variables = Object.fromEntries(
    Object.entries(scale).map(([shade, rgb]) => [
      `--ui-primary-${shade}-rgb`,
      rgb,
    ]),
  );
  return (
    <div
      aria-label="Branding preview"
      style={
        {
          ...variables,
          "--ui-primary-strong": `rgb(${scale[600]})`,
        } as CSSProperties
      }
      className="rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3"
    >
      <p className="mb-2 text-xs text-[var(--ui-text-muted)]">Preview</p>
      <div className="flex flex-wrap items-center gap-2">
        <SettingsButton tabIndex={-1} onClick={() => {}}>
          Primary action
        </SettingsButton>
        <UiBadge tone="primary">Selected</UiBadge>
      </div>
    </div>
  );
}
