/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { CSSProperties } from "react";
import { useTheme } from "../../../components/theme";
import { generatePrimaryScale } from "../../../components/ui/brandingRuntime";
import UiBadge from "../../../components/ui/UiBadge";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import { useAdminI18n } from "../adminI18n";

export default function BrandingPreview({ color }: { color: string }) {
  const { text: adminText } = useAdminI18n();
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
      aria-label={adminText("Branding preview")}
      style={
        {
          ...variables,
          "--ui-primary-strong": `rgb(${scale[600]})`,
        } as CSSProperties
      }
      className="rounded border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3"
    >
      <p className="mb-2 text-xs text-[var(--ui-text-muted)]">{adminText("Preview")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SettingsButton tabIndex={-1} onClick={() => {}}>
          {adminText("Primary action")}</SettingsButton>
        <UiBadge tone="primary">{adminText("Selected")}</UiBadge>
      </div>
    </div>
  );
}
