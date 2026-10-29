/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { TopbarControlRenderMode } from "../../components/topbarControlsLayout";
import TopbarDropdownSelect, { type TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import { TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS } from "../../components/topbarControlWidths";
import { useShellI18n } from "../../components/shellMessages";

export function OpenStackRegionIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.2 3.4 4.9 3.4 8S14.2 17.8 12 20c-2.2-2.2-3.4-4.9-3.4-8S9.8 6.2 12 4Z" />
    </svg>
  );
}

type OpenStackRegionControlProps = {
  mode: TopbarControlRenderMode;
  currentRegion: string | null;
  currentTargetId: string;
  options: TopbarDropdownOption[];
  loading: boolean;
  onChange: (targetId: string) => void;
};

export default function OpenStackRegionControl({
  mode,
  currentRegion,
  currentTargetId,
  options,
  loading,
  onChange,
}: OpenStackRegionControlProps) {
  const { text } = useShellI18n();
  const icon = <OpenStackRegionIcon className="h-4 w-4" />;
  const regionLabel = currentRegion ?? text("selectRegion");

  if (!loading && options.length > 1) {
    return (
      <TopbarDropdownSelect
        value={currentTargetId}
        options={options}
        onChange={onChange}
        ariaLabel={text("selectRegion")}
        triggerLabel={text("region")}
        placeholder={regionLabel}
        triggerValue={regionLabel}
        title={regionLabel}
        widthClassName={mode === "icon" ? TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS : "w-44 max-w-[35vw] min-w-[10rem]"}
        menuMinWidthClassName="min-w-[22rem]"
        icon={icon}
        triggerMode={mode}
      />
    );
  }

  if (mode === "icon") {
    return (
      <div
        title={`${text("region")}: ${regionLabel}`}
        aria-label={`${text("region")}: ${regionLabel}`}
        className={`shell-control-static inline-flex h-9 ${TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS} items-center justify-center rounded-lg border`}
      >
        {icon}
      </div>
    );
  }

  return (
    <div
      title={`${text("region")}: ${regionLabel}`}
      className="shell-control-static inline-flex h-10 w-44 max-w-[35vw] min-w-[10rem] items-center gap-2.5 rounded-lg border px-3 text-left"
    >
      <span className="shell-icon-muted shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="shell-muted-text block truncate text-[10px] font-medium">{text("region")}</span>
        <span className="mt-0.5 block truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
          {regionLabel}
        </span>
      </span>
    </div>
  );
}
