/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useId } from "react";

import type { IamPolicy } from "../../api/managerIamPolicies";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import { SettingsButton } from "../../components/settings/SettingsControls";
import { SettingsSection } from "../../components/settings/SettingsLayout";
import { useManagerI18n } from "./managerI18n";
import IamCursorPaginationControls from "./IamCursorPaginationControls";

type ManagedPolicySelectionPanelProps = {
  title: string;
  description: string;
  emptyMessage: string;
  footer: string;
  policies: IamPolicy[];
  selectedPolicyArns: string[];
  search: string;
  expanded: boolean;
  loading: boolean;
  page: number;
  pageSize: number;
  canPrevious: boolean;
  canNext: boolean;
  onSearchChange: (value: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
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
  loading,
  page,
  pageSize,
  canPrevious,
  canNext,
  onSearchChange,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
  onExpandedChange,
  onSelectionChange,
}: ManagedPolicySelectionPanelProps) {
  const { text } = useManagerI18n();
  const contentId = useId();

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
            <span className="settings-description">{selectedPolicyArns.length} {text("selected")}</span>
          )}
          <SettingsButton
            variant="secondary"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => onExpandedChange(!expanded)}
          >
            {text(expanded ? "Hide" : "Show")}
          </SettingsButton>
        </div>
        <div id={contentId} hidden={!expanded} className={expanded ? "settings-fields" : undefined}>
          <>
            <UiInput
              label={text("Search policies")}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={text("Search policies by name or ARN")}
            />
            <div className="grid gap-x-4 sm:grid-cols-2">
              {!loading && policies.length === 0 && (
                <p className="settings-description">{search.trim() ? text("No matching policies.") : emptyMessage}</p>
              )}
              {policies.map((policy) => (
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
            <IamCursorPaginationControls
              page={page}
              pageSize={pageSize}
              canPrevious={canPrevious}
              canNext={canNext}
              disabled={loading}
              onPrevious={onPreviousPage}
              onNext={onNextPage}
              onPageSizeChange={onPageSizeChange}
            />
          </>
          <p className="settings-description">{footer}</p>
        </div>
      </div>
    </SettingsSection>
  );
}
