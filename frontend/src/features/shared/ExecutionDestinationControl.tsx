/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { TopbarControlRenderMode } from "../../components/topbarControlsLayout";
import TopbarDropdownSelect, { type TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import { TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS } from "../../components/topbarControlWidths";
import { useShellI18n } from "../../components/shellMessages";
import { OpenStackRegionIcon } from "./OpenStackRegionControl";

type ExecutionDestinationControlProps = {
  mode: TopbarControlRenderMode;
  currentLabel: string;
  currentTargetId: string;
  options: TopbarDropdownOption[];
  onChange: (targetId: string) => void;
};

export default function ExecutionDestinationControl({
  mode,
  currentLabel,
  currentTargetId,
  options,
  onChange,
}: ExecutionDestinationControlProps) {
  const { text } = useShellI18n();
  const icon = <OpenStackRegionIcon className="h-4 w-4" />;

  return (
    <TopbarDropdownSelect
      value={currentTargetId}
      options={options}
      onChange={onChange}
      ariaLabel={text("selectS3Endpoint")}
      triggerLabel={text("s3Endpoint")}
      placeholder={currentLabel}
      triggerValue={currentLabel}
      title={currentLabel}
      widthClassName={mode === "icon" ? TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS : "w-52 max-w-[38vw] min-w-[11rem]"}
      menuMinWidthClassName="min-w-[24rem]"
      icon={icon}
      triggerMode={mode}
    />
  );
}
