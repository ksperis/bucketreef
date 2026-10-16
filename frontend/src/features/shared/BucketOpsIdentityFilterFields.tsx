/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiSelect from "../../components/ui/UiSelect";
import { cx } from "../../components/ui/styles";
import AdvancedFilterTextMatchField from "./AdvancedFilterTextMatchField";
import AdvancedFilterSelectField from "./AdvancedFilterSelectField";
import {
  BOOLEAN_FILTER_OPTIONS,
  type AdvancedFilterState,
} from "./bucketOpsAdvancedFilterModel";
import type { useBucketOpsFilterController } from "./useBucketOpsFilterController";
import { useSharedI18n } from "./sharedI18n";

type FilterController = ReturnType<typeof useBucketOpsFilterController>;

type IdentityFilterController = Pick<
  FilterController,
  | "ownerDraftEffectiveMatchMode"
  | "ownerDraftForcesExact"
  | "ownerFieldState"
  | "ownerNameDraftEffectiveMatchMode"
  | "ownerNameDraftForcesExact"
  | "ownerNameFieldState"
  | "ownerSuspendedFieldState"
  | "s3TagsDraftEffectiveMatchMode"
  | "s3TagsDraftForcesExact"
  | "s3TagsFieldState"
  | "tenantDraftEffectiveMatchMode"
  | "tenantDraftForcesExact"
  | "tenantFieldState"
  | "updateAdvancedField"
  | "updateAdvancedMatchMode"
  | "updateAdvancedOwnerNameScope"
  | "updateAdvancedOwnerSuspended"
>;

type BucketOpsIdentityFilterFieldsProps = {
  advancedDraft: AdvancedFilterState;
  controller: IdentityFilterController;
};

export default function BucketOpsIdentityFilterFields({
  advancedDraft,
  controller,
}: BucketOpsIdentityFilterFieldsProps) {
  const { text: surfaceText } = useSharedI18n();
  const {
    ownerDraftEffectiveMatchMode,
    ownerDraftForcesExact,
    ownerFieldState,
    ownerNameDraftEffectiveMatchMode,
    ownerNameDraftForcesExact,
    ownerNameFieldState,
    ownerSuspendedFieldState,
    s3TagsDraftEffectiveMatchMode,
    s3TagsDraftForcesExact,
    s3TagsFieldState,
    tenantDraftEffectiveMatchMode,
    tenantDraftForcesExact,
    tenantFieldState,
    updateAdvancedField,
    updateAdvancedMatchMode,
    updateAdvancedOwnerNameScope,
    updateAdvancedOwnerSuspended,
  } = controller;

  return (
    <>
      <AdvancedFilterTextMatchField
        costLevel="low"
        costTooltip="Low cost: tenant filter runs on direct bucket metadata."
        fieldState={tenantFieldState}
        forcesExact={tenantDraftForcesExact}
        label={surfaceText("Tenant")}
        matchMode={tenantDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("tenant", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("tenantMatchMode", value)
        }
        placeholder={surfaceText("tenant-a, tenant-b")}
        value={advancedDraft.tenant}
      />

      <AdvancedFilterTextMatchField
        costLevel="low"
        costTooltip="Low cost: owner filter runs on direct bucket metadata."
        fieldState={ownerFieldState}
        forcesExact={ownerDraftForcesExact}
        label={surfaceText("Owner")}
        matchMode={ownerDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("owner", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("ownerMatchMode", value)
        }
        placeholder={surfaceText("owner uid(s)")}
        value={advancedDraft.owner}
      />

      <AdvancedFilterTextMatchField
        className="md:col-span-2"
        costLevel="medium"
        costTooltip="Medium cost: owner-name filters require owner identity lookups."
        fieldState={ownerNameFieldState}
        forcesExact={ownerNameDraftForcesExact}
        label={surfaceText("Owner name")}
        matchMode={ownerNameDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("ownerName", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("ownerNameMatchMode", value)
        }
        placeholder={surfaceText("display name(s)")}
        value={advancedDraft.ownerName}
      >
        <div className="mt-2 max-w-xs">
          <UiSelect
            label={surfaceText("Owner type")}
            title={surfaceText("Owner entity scope")}
            size="compact"
            value={advancedDraft.ownerNameScope}
            onChange={(event) =>
              updateAdvancedOwnerNameScope(
                event.target.value as AdvancedFilterState["ownerNameScope"],
              )
            }
            className={cx("ui-list-control", ownerNameFieldState.fieldClass)}
          >
            <option value="any">{surfaceText("Accounts + Users")}</option>
            <option value="account">{surfaceText("Accounts only")}</option>
            <option value="user">{surfaceText("Users only")}</option>
          </UiSelect>
        </div>
      </AdvancedFilterTextMatchField>

      <AdvancedFilterSelectField
        label={surfaceText("Owner suspended")}
        costLevel="medium"
        costTooltip="Medium cost: owner-suspended filters require owner status lookups."
        fieldState={ownerSuspendedFieldState}
        value={advancedDraft.ownerSuspended}
        onChange={(value) =>
          updateAdvancedOwnerSuspended(
            value as AdvancedFilterState["ownerSuspended"],
          )
        }
      >
        {BOOLEAN_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </AdvancedFilterSelectField>

      <AdvancedFilterTextMatchField
        className="md:col-span-2"
        costLevel="high"
        costTooltip="High cost: S3 tag filters require bucket tag retrieval."
        fieldState={s3TagsFieldState}
        forcesExact={s3TagsDraftForcesExact}
        label={surfaceText("S3 tags")}
        matchMode={s3TagsDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("s3Tags", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("s3TagsMatchMode", value)
        }
        placeholder={surfaceText("env=prod, team=storage")}
        value={advancedDraft.s3Tags}
      >
        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
          {surfaceText("Comma or newline separated expressions. Format examples:")}{" "}
          <code>{surfaceText("key=value")}</code>, <code>{surfaceText("env")}</code>.
        </p>
      </AdvancedFilterTextMatchField>
    </>
  );
}
