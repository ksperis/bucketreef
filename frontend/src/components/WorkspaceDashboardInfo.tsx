/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import UiInfoTooltip from "./ui/UiInfoTooltip";
import "./compactDashboard.css";

export default function WorkspaceDashboardInfo({ label, children }: { label: string; children: ReactNode }) {
  return <UiInfoTooltip label={label} triggerClassName="ui-dashboard-action ui-dashboard-action-icon" tooltipClassName="ui-dashboard-info-tooltip">{children}</UiInfoTooltip>;
}
