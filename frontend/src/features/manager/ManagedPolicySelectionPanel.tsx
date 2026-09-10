/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId, useMemo } from "react";

import type { IamPolicy } from "../../api/managerIamPolicies";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";

type ManagedPolicySelectionPanelProps = {
  title: string;
  description: string;
  emptyMessage: string;
  footer: string;
  policies: IamPolicy[];
  selectedPolicyArns: string[];
  search: string;
  expanded: boolean;
  onSearchChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  onSelectionChange: (policyArns: string[]) => void;
};

export default function ManagedPolicySelectionPanel({
  title,
  description,
  emptyMessage,
  footer,
  policies,
  selectedPolicyArns,
  search,
  expanded,
  onSearchChange,
  onExpandedChange,
  onSelectionChange,
}: ManagedPolicySelectionPanelProps) {
  const contentId = useId();
  const filteredPolicies = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return policies;
    return policies.filter((policy) =>
      [policy.name, policy.arn].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [policies, search]);

  const updateSelection = (policyArn: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedPolicyArns, policyArn]);
      return;
    }
    onSelectionChange(selectedPolicyArns.filter((arn) => arn !== policyArn));
  };

  return (
    <SettingsSection title={title} description={description} presentation="compact">
      <div className="settings-stack">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedPolicyArns.length > 0 && (
            <span className="settings-description">{selectedPolicyArns.length} selected</span>
          )}
          <SettingsButton
            variant="secondary"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? "Hide" : "Show"}
          </SettingsButton>
        </div>
        <div id={contentId} hidden={!expanded} className={expanded ? "settings-fields" : undefined}>
          {policies.length === 0 ? (
            <p className="settings-description">{emptyMessage}</p>
          ) : (
            <>
              <UiInput
                label="Search policies"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search policies by name or ARN"
              />
              <div className="grid gap-x-4 sm:grid-cols-2">
                {filteredPolicies.length === 0 && (
                  <p className="settings-description">No matching policies.</p>
                )}
                {filteredPolicies.map((policy) => (
                  <UiCheckboxField
                    key={policy.arn}
                    checked={selectedPolicyArns.includes(policy.arn)}
                    onChange={(event) => updateSelection(policy.arn, event.target.checked)}
                    className="settings-choice min-w-0 settings-body"
                    labelProps={{ title: policy.arn }}
                  >
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{policy.name}</span>
                  </UiCheckboxField>
                ))}
              </div>
            </>
          )}
          <p className="settings-description">{footer}</p>
        </div>
      </div>
    </SettingsSection>
  );
}
