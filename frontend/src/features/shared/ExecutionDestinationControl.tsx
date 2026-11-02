/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { TopbarControlRenderMode } from "../../components/topbarControlsLayout";
import TopbarDropdownSelect, { type TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import { TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS } from "../../components/topbarControlWidths";
import { useShellI18n } from "../../components/shellMessages";
import type { ExecutionDestination } from "../../api/executionContexts";
import { OpenStackRegionIcon } from "./OpenStackRegionControl";

type ExecutionDestinationOptionSource = Pick<
  ExecutionDestination,
  "endpoint_id" | "name" | "endpoint_url" | "region" | "zone_id"
>;

export function buildExecutionDestinationControlModel(
  destinations: readonly ExecutionDestinationOptionSource[],
  selectedEndpointId: number | null,
  fallbackEndpointId: number | null,
  rgwZoneLabel: string,
) {
  const active = destinations.find(
    (destination) => destination.endpoint_id === selectedEndpointId,
  ) ?? destinations.find(
    (destination) => destination.endpoint_id === fallbackEndpointId,
  ) ?? destinations[0] ?? null;
  const options: TopbarDropdownOption[] = destinations.map((destination) => ({
    value: String(destination.endpoint_id),
    label: destination.name,
    description: [
      destination.zone_id ? `${rgwZoneLabel}: ${destination.zone_id}` : null,
      destination.region,
      destination.endpoint_url,
    ].filter(Boolean).join(" · "),
    searchText: [destination.name, destination.zone_id, destination.region, destination.endpoint_url]
      .filter(Boolean)
      .join(" "),
  }));
  return { active, options };
}

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
