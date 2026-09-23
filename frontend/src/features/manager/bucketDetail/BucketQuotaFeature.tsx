/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { FormEvent } from "react";
import { ListBadge } from "../../../components/list/ListControls";
import { SettingsButton } from "../../../components/settings/SettingsControls";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import { cx, uiInputClass } from "../../../components/ui/styles";
import BucketFeatureSection from "./BucketFeatureSection";
import EndpointFeatureDisabledNotice from "./EndpointFeatureDisabledNotice";
import { resolveFeatureVisualState } from "./bucketFeatureState";
import type { BucketQuotaUnit, useBucketQuotaController } from "./useBucketQuotaController";

type BucketQuotaController = ReturnType<typeof useBucketQuotaController>;

type BucketQuotaFeatureProps = {
  controller: BucketQuotaController;
  editable: boolean;
  featureEnabled: boolean;
  loading: boolean;
};

const formId = "bucket-quota-form";
const inputClass = cx(uiInputClass, "settings-control");
const labelClass = "settings-label flex flex-col gap-1";

export default function BucketQuotaFeature({
  controller,
  editable,
  featureEnabled,
  loading,
}: BucketQuotaFeatureProps) {
  const {
    configured,
    dirty,
    error,
    maxObjects,
    maxSize,
    save,
    saving,
    status,
    unit,
    updateMaxObjects,
    updateMaxSize,
    updateUnit,
  } = controller;
  const restricted = featureEnabled && !editable;
  const visualState = resolveFeatureVisualState({
    disabled: !featureEnabled || restricted,
    configured,
    unsaved: dirty,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  return (
    <BucketFeatureSection
      title="Quota"
      description="Allowed bucket size and object count."
      mode="graphical"
      visualState={visualState}
      successMessage={status}
      busy={saving || loading}
      testId="bucket-feature-quota"
      actions={
        restricted ? (
          <ListBadge tone="neutral">Restricted</ListBadge>
        ) : editable ? (
          <SettingsButton type="submit" form={formId} disabled={saving || !dirty} variant="primary">
            {saving ? "Saving..." : "Save"}
          </SettingsButton>
        ) : null
      }
    >
      {!featureEnabled && <EndpointFeatureDisabledNotice featureLabel="Quota" />}
      <form
        id={formId}
        className={`mt-2 space-y-2 ${restricted ? "pointer-events-none" : ""}`}
        onSubmit={submit}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className={labelClass}>
            Size
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                step="0.1"
                value={maxSize}
                onChange={(event) => updateMaxSize(event.target.value)}
                className={cx(inputClass, "flex-1")}
                placeholder="e.g. 100"
                disabled={!editable}
              />
              <select
                value={unit}
                aria-label="Quota size unit"
                onChange={(event) => updateUnit(event.target.value as BucketQuotaUnit)}
                className={cx(inputClass, "w-20")}
                disabled={!editable}
              >
                <option value="MiB">MiB</option>
                <option value="GiB">GiB</option>
                <option value="TiB">TiB</option>
              </select>
            </div>
          </label>
          <label className={labelClass}>
            Object count
            <input
              type="number"
              min={0}
              step="1"
              value={maxObjects}
              onChange={(event) => updateMaxObjects(event.target.value)}
              className={inputClass}
              placeholder="e.g. 1000000"
              disabled={!editable}
            />
          </label>
        </div>
        {error && <UiInlineMessage tone="error">{error}</UiInlineMessage>}
      </form>
      <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
        {featureEnabled
          ? `Leave empty to remove the quota. ${editable ? "" : "(Privileged Ceph access required.)"}`
          : "Quota management is unavailable on this endpoint."}
      </p>
    </BucketFeatureSection>
  );
}
