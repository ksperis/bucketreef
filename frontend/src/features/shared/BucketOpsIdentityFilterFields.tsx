/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import AdvancedFilterTextMatchField from "./AdvancedFilterTextMatchField";
import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
  advancedFilterMatchModeButtonClass,
  renderFilterCostIndicator,
} from "./advancedFilterShared";
import {
  BOOLEAN_FILTER_OPTIONS,
  type AdvancedFilterState,
} from "./bucketOpsAdvancedFilterModel";
import type { useBucketOpsFilterController } from "./useBucketOpsFilterController";

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
        label="Tenant"
        matchMode={tenantDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("tenant", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("tenantMatchMode", value)
        }
        placeholder="tenant-a, tenant-b"
        value={advancedDraft.tenant}
      />

      <AdvancedFilterTextMatchField
        costLevel="low"
        costTooltip="Low cost: owner filter runs on direct bucket metadata."
        fieldState={ownerFieldState}
        forcesExact={ownerDraftForcesExact}
        label="Owner"
        matchMode={ownerDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("owner", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("ownerMatchMode", value)
        }
        placeholder="owner uid(s)"
        value={advancedDraft.owner}
      />

      <div className={advancedFilterFieldCardClass("md:col-span-2")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerNameFieldState.labelClass}`}
          >
            <span className="inline-flex items-center gap-1">
              <span>Owner name</span>
              {renderFilterCostIndicator(
                "medium",
                "Medium cost: owner-name filters require owner identity lookups.",
              )}
            </span>
          </label>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={ownerNameDraftForcesExact}
              onClick={() =>
                updateAdvancedMatchMode("ownerNameMatchMode", "contains")
              }
              className={advancedFilterMatchModeButtonClass(
                ownerNameDraftEffectiveMatchMode === "contains",
                ownerNameDraftForcesExact,
              )}
            >
              Contains
            </button>
            <button
              type="button"
              disabled={ownerNameDraftForcesExact}
              onClick={() =>
                updateAdvancedMatchMode("ownerNameMatchMode", "exact")
              }
              className={advancedFilterMatchModeButtonClass(
                ownerNameDraftEffectiveMatchMode === "exact",
                ownerNameDraftForcesExact,
              )}
            >
              Exact
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
          <textarea
            value={advancedDraft.ownerName}
            onChange={(event) =>
              updateAdvancedField("ownerName", event.target.value)
            }
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="display name(s)"
            rows={2}
            className={advancedFilterControlClass(
              `w-full resize-y px-2 py-1.5 font-normal ${ownerNameFieldState.fieldClass}`,
            )}
          />
          <select
            value={advancedDraft.ownerNameScope}
            onChange={(event) =>
              updateAdvancedOwnerNameScope(
                event.target.value as AdvancedFilterState["ownerNameScope"],
              )
            }
            className={advancedFilterControlClass(
              `px-2 py-1.5 font-normal ${ownerNameFieldState.fieldClass}`,
            )}
            title="Owner entity scope"
          >
            <option value="any">Accounts + Users</option>
            <option value="account">Accounts only</option>
            <option value="user">Users only</option>
          </select>
        </div>
      </div>

      <div className={advancedFilterFieldCardClass()}>
        <label
          className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${ownerSuspendedFieldState.labelClass}`}
        >
          <span className="inline-flex items-center gap-1">
            <span>Owner suspended</span>
            {renderFilterCostIndicator(
              "medium",
              "Medium cost: owner-suspended filters require owner status lookups.",
            )}
          </span>
        </label>
        <select
          value={advancedDraft.ownerSuspended}
          onChange={(event) =>
            updateAdvancedOwnerSuspended(
              event.target.value as AdvancedFilterState["ownerSuspended"],
            )
          }
          className={advancedFilterControlClass(
            `mt-2 w-full px-2 py-1.5 font-normal ${ownerSuspendedFieldState.fieldClass}`,
          )}
        >
          {BOOLEAN_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <AdvancedFilterTextMatchField
        className="md:col-span-2"
        costLevel="high"
        costTooltip="High cost: S3 tag filters require bucket tag retrieval."
        fieldState={s3TagsFieldState}
        forcesExact={s3TagsDraftForcesExact}
        label="S3 tags"
        matchMode={s3TagsDraftEffectiveMatchMode}
        onChange={(value) => updateAdvancedField("s3Tags", value)}
        onMatchModeChange={(value) =>
          updateAdvancedMatchMode("s3TagsMatchMode", value)
        }
        placeholder="env=prod, team=storage"
        value={advancedDraft.s3Tags}
      >
        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
          Comma or newline separated expressions. Format examples:{" "}
          <code>key=value</code>, <code>env</code>.
        </p>
      </AdvancedFilterTextMatchField>
    </>
  );
}
