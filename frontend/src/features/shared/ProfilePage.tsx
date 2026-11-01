/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { workflowPageHostClass } from "../../components/WorkflowPage";
import PrivateS3ConnectionsSection from "./PrivateS3ConnectionsSection";
import ProfilePreferencesPage from "./ProfilePreferencesPage";

type ProfilePageProps = {
  profilePath?: string;
  showSettingsCards?: boolean;
  showConnectionsSection?: boolean;
  onUnsavedChangesChange?: (dirty: boolean) => void;
};

export default function ProfilePage({
  profilePath = "/",
  showSettingsCards: showSettingsCardsProp = true,
  showConnectionsSection: showConnectionsSectionProp = false,
  onUnsavedChangesChange,
}: ProfilePageProps) {
  const [searchParams] = useSearchParams();
  const profileView = searchParams.get("view");
  const showConnectionsSection = showConnectionsSectionProp || profileView === "connections";
  const showSettingsCards = showSettingsCardsProp && profileView !== "connections";
  const [settingsHaveUnsavedChanges, setSettingsHaveUnsavedChanges] = useState(false);
  const [connectionsHaveUnsavedChanges, setConnectionsHaveUnsavedChanges] = useState(false);
  const [connectionsWorkflowActive, setConnectionsWorkflowActive] = useState(false);

  useEffect(() => {
    onUnsavedChangesChange?.(
      (showSettingsCards && settingsHaveUnsavedChanges) ||
        (showConnectionsSection && connectionsHaveUnsavedChanges),
    );
  }, [
    connectionsHaveUnsavedChanges,
    onUnsavedChangesChange,
    settingsHaveUnsavedChanges,
    showConnectionsSection,
    showSettingsCards,
  ]);

  return (
    <div className={workflowPageHostClass(showConnectionsSection && connectionsWorkflowActive)}>
      {showSettingsCards && (
        <ProfilePreferencesPage onUnsavedChangesChange={setSettingsHaveUnsavedChanges} />
      )}
      {showConnectionsSection && (
        <PrivateS3ConnectionsSection
          profilePath={profilePath}
          onUnsavedChangesChange={setConnectionsHaveUnsavedChanges}
          onWorkflowActiveChange={setConnectionsWorkflowActive}
        />
      )}
    </div>
  );
}
