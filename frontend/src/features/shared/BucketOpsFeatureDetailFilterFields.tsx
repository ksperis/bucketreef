/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  type FeatureDetailFilterKey,
  type FeatureDetailFilters,
  type FeatureTriState,
  type NumericComparisonOpUi,
} from "../cephAdmin/filtering/bucketAdvancedFilter";
import {
  advancedFilterFieldCardClass,
} from "./advancedFilterShared";
import {
  BOOLEAN_FILTER_OPTIONS,
  NUMERIC_FILTER_OPTIONS,
} from "./bucketOpsAdvancedFilterModel";
import {
  LIFECYCLE_TYPE_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
} from "./bucketConfigMerge";
import { useSharedI18n } from "./sharedI18n";

type FieldChangeHandler = (
  field: FeatureDetailFilterKey,
  value: FeatureDetailFilters[FeatureDetailFilterKey],
) => void;

type BucketOpsFeatureDetailFilterFieldsProps = {
  filters: FeatureDetailFilters;
  onFieldChange: FieldChangeHandler;
  sseFeatureEnabled: boolean;
};

type FilterControlProps = {
  filters: FeatureDetailFilters;
  onFieldChange: FieldChangeHandler;
};

type SelectOption = {
  label: string;
  value: string;
};

type NumericComparisonFieldKey = {
  [Key in FeatureDetailFilterKey]: FeatureDetailFilters[Key] extends NumericComparisonOpUi
    ? Key
    : never;
}[FeatureDetailFilterKey];

type BooleanFilterFieldKey = {
  [Key in FeatureDetailFilterKey]: FeatureDetailFilters[Key] extends FeatureTriState
    ? Key
    : never;
}[FeatureDetailFilterKey];

type NumericFilterDefinition = {
  label: string;
  opField: NumericComparisonFieldKey;
  placeholder: string;
  valueField: FeatureDetailFilterKey;
};

type PresenceTextFilterDefinition = {
  label: string;
  modeField: FeatureDetailFilterKey;
  placeholder: string;
  valueField: FeatureDetailFilterKey;
};

type BooleanFilterDefinition = {
  field: BooleanFilterFieldKey;
  label: string;
};

const FIELD_LABEL_CLASS =
  "ui-caption font-medium text-slate-700 dark:text-slate-200";
const FULL_CONTROL_CLASS = "ui-list-control mt-1 w-full";
const PAIR_MODE_FIELD_CLASS = "col-span-2";
const PAIR_VALUE_FIELD_CLASS = "col-span-3";

const PRESENCE_FILTER_OPTIONS: SelectOption[] = [
  { value: "any", label: "Any" },
  { value: "has", label: "Has" },
  { value: "has_not", label: "Has not" },
];
const LIFECYCLE_RULE_NAME_MODE_OPTIONS: SelectOption[] = [
  { value: "any", label: "Any" },
  { value: "has_named", label: "Has named rule" },
  { value: "has_not_named", label: "Has no named rule" },
];
const LIFECYCLE_RULE_TYPE_MODE_OPTIONS: SelectOption[] = [
  { value: "any", label: "Any" },
  { value: "has", label: "Has rule type" },
  { value: "has_not", label: "Has no rule type" },
];
const LIFECYCLE_RULE_STATUS_OPTIONS: SelectOption[] = [
  { value: "", label: "Any" },
  { value: "Enabled", label: "Enabled" },
  { value: "Disabled", label: "Disabled" },
];
const LIFECYCLE_RULE_TYPE_VALUE_OPTIONS: SelectOption[] = [
  { value: "", label: "Select type" },
  ...LIFECYCLE_TYPE_OPTIONS.map((option) => ({
    value: option.key,
    label: option.label,
  })),
];
const NOTIFICATION_RULE_TYPE_VALUE_OPTIONS: SelectOption[] = [
  { value: "", label: "Select type" },
  ...NOTIFICATION_TYPE_OPTIONS.filter(
    (option) => option.key !== "eventbridge",
  ).map((option) => ({
    value: option.key,
    label: option.label,
  })),
];
const OBJECT_LOCK_MODE_OPTIONS: SelectOption[] = [
  { value: "", label: "Any" },
  { value: "GOVERNANCE", label: "GOVERNANCE" },
  { value: "COMPLIANCE", label: "COMPLIANCE" },
];

const LIFECYCLE_NUMERIC_FILTERS: NumericFilterDefinition[] = [
  {
    label: "Expiration days",
    opField: "lifecycleExpirationDaysOp",
    valueField: "lifecycleExpirationDays",
    placeholder: "days",
  },
  {
    label: "Noncurrent expiration days",
    opField: "lifecycleNoncurrentExpirationDaysOp",
    valueField: "lifecycleNoncurrentExpirationDays",
    placeholder: "days",
  },
  {
    label: "Transition days",
    opField: "lifecycleTransitionDaysOp",
    valueField: "lifecycleTransitionDays",
    placeholder: "days",
  },
  {
    label: "Abort days",
    opField: "lifecycleAbortDaysOp",
    valueField: "lifecycleAbortDays",
    placeholder: "days",
  },
];
const NOTIFICATION_PRESENCE_FILTERS: PresenceTextFilterDefinition[] = [
  {
    label: "Event",
    modeField: "notificationEventMode",
    valueField: "notificationEventValue",
    placeholder: "s3:ObjectCreated:*",
  },
  {
    label: "Filter prefix",
    modeField: "notificationFilterPrefixMode",
    valueField: "notificationFilterPrefixValue",
    placeholder: "incoming/",
  },
  {
    label: "Filter suffix",
    modeField: "notificationFilterSuffixMode",
    valueField: "notificationFilterSuffixValue",
    placeholder: ".csv",
  },
];
const OBJECT_LOCK_NUMERIC_FILTERS: NumericFilterDefinition[] = [
  {
    label: "Object Lock retention days",
    opField: "objectLockRetentionOp",
    valueField: "objectLockRetentionDays",
    placeholder: "days",
  },
  {
    label: "Object Lock retention years",
    opField: "objectLockRetentionYearsOp",
    valueField: "objectLockRetentionYears",
    placeholder: "years",
  },
];
const BPA_BOOLEAN_FILTERS: BooleanFilterDefinition[] = [
  { field: "bpaBlockPublicAcls", label: "Block public ACLs" },
  { field: "bpaIgnorePublicAcls", label: "Ignore public ACLs" },
  { field: "bpaBlockPublicPolicy", label: "Block public policy" },
  { field: "bpaRestrictPublicBuckets", label: "Restrict public buckets" },
];
const CORS_PRESENCE_FILTERS: PresenceTextFilterDefinition[] = [
  {
    label: "CORS method",
    modeField: "corsMethodMode",
    valueField: "corsMethodValue",
    placeholder: "GET",
  },
  {
    label: "CORS origin",
    modeField: "corsOriginMode",
    valueField: "corsOriginValue",
    placeholder: "https://example.test",
  },
];
const WEBSITE_BOOLEAN_FILTERS: BooleanFilterDefinition[] = [
  { field: "websiteIndexPresent", label: "Website index present" },
  {
    field: "websiteRedirectHostPresent",
    label: "Website redirect host present",
  },
];
const WEBSITE_NUMERIC_FILTERS: NumericFilterDefinition[] = [
  {
    label: "Website routing rules",
    opField: "websiteRoutingRuleCountOp",
    valueField: "websiteRoutingRuleCount",
    placeholder: "count",
  },
  {
    label: "Policy statements",
    opField: "policyStatementOp",
    valueField: "policyStatementCount",
    placeholder: "count",
  },
];

const fieldId = (field: FeatureDetailFilterKey) =>
  "bucket-ops-feature-detail-" + field;

function FeatureDetailCard({
  children,
  description,
  disabled = false,
  title,
}: {
  children: ReactNode;
  description?: string;
  disabled?: boolean;
  title: string;
}) {
  return (
    <div className={advancedFilterFieldCardClass(disabled ? "opacity-60" : "")}>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </p>
      {description && (
        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function TextFilterField({
  className = FULL_CONTROL_CLASS,
  disabled = false,
  field,
  filters,
  label,
  onFieldChange,
  placeholder,
}: FilterControlProps & {
  className?: string;
  disabled?: boolean;
  field: FeatureDetailFilterKey;
  label: string;
  placeholder: string;
}) {
  const { text: surfaceText } = useSharedI18n();
  const id = fieldId(field);
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {surfaceText(label)}
      </label>
      <UiInput
        id={id}
        type="text"
        value={filters[field]}
        onChange={(event) => onFieldChange(field, event.target.value)}
        placeholder={surfaceText(placeholder)}
        disabled={disabled}
        size="compact"
        className={className}
      />
    </div>
  );
}

function SelectFilterField({
  className = FULL_CONTROL_CLASS,
  disabled = false,
  field,
  filters,
  label,
  onFieldChange,
  options,
}: FilterControlProps & {
  className?: string;
  disabled?: boolean;
  field: FeatureDetailFilterKey;
  label: string;
  options: SelectOption[];
}) {
  const { text: surfaceText } = useSharedI18n();
  const id = fieldId(field);
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {surfaceText(label)}
      </label>
      <UiSelect
        id={id}
        value={filters[field]}
        onChange={(event) => onFieldChange(field, event.target.value)}
        disabled={disabled}
        size="compact"
        className={className}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {surfaceText(option.label)}
          </option>
        ))}
      </UiSelect>
    </div>
  );
}

function PresenceTextFilterField({
  filters,
  label,
  modeField,
  modeOptions = PRESENCE_FILTER_OPTIONS,
  onFieldChange,
  placeholder,
  valueField,
}: FilterControlProps & PresenceTextFilterDefinition & {
  modeOptions?: SelectOption[];
}) {
  const { text: surfaceText } = useSharedI18n();
  const translatedLabel = surfaceText(label);
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{translatedLabel}</p>
      <div className="mt-1 grid grid-cols-5 gap-2">
        <UiSelect
          id={fieldId(modeField)}
          aria-label={surfaceText("{label} mode", { label: translatedLabel })}
          value={filters[modeField]}
          onChange={(event) => onFieldChange(modeField, event.target.value)}
          size="compact"
          fieldClassName={PAIR_MODE_FIELD_CLASS}
          className="ui-list-control"
        >
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {surfaceText(option.label)}
            </option>
          ))}
        </UiSelect>
        <UiInput
          id={fieldId(valueField)}
          aria-label={surfaceText("{label} value", { label: translatedLabel })}
          type="text"
          value={filters[valueField]}
          onChange={(event) => onFieldChange(valueField, event.target.value)}
          placeholder={surfaceText(placeholder)}
          size="compact"
          fieldClassName={PAIR_VALUE_FIELD_CLASS}
          className="ui-list-control"
        />
      </div>
    </div>
  );
}

function PresenceSelectFilterField({
  filters,
  label,
  modeField,
  modeOptions,
  onFieldChange,
  valueField,
  valueOptions,
}: FilterControlProps & {
  label: string;
  modeField: FeatureDetailFilterKey;
  modeOptions: SelectOption[];
  valueField: FeatureDetailFilterKey;
  valueOptions: SelectOption[];
}) {
  const { text: surfaceText } = useSharedI18n();
  const translatedLabel = surfaceText(label);
  const valueDisabled = filters[modeField] === "any";
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{translatedLabel}</p>
      <div className="mt-1 grid grid-cols-5 gap-2">
        <UiSelect
          id={fieldId(modeField)}
          aria-label={surfaceText("{label} mode", { label: translatedLabel })}
          value={filters[modeField]}
          onChange={(event) => onFieldChange(modeField, event.target.value)}
          size="compact"
          fieldClassName={PAIR_MODE_FIELD_CLASS}
          className="ui-list-control"
        >
          {modeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {surfaceText(option.label)}
            </option>
          ))}
        </UiSelect>
        <UiSelect
          id={fieldId(valueField)}
          aria-label={surfaceText("{label} value", { label: translatedLabel })}
          value={filters[valueField]}
          onChange={(event) => onFieldChange(valueField, event.target.value)}
          disabled={valueDisabled}
          size="compact"
          fieldClassName={PAIR_VALUE_FIELD_CLASS}
          className="ui-list-control"
        >
          {valueOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {surfaceText(option.label)}
            </option>
          ))}
        </UiSelect>
      </div>
    </div>
  );
}

function NumericComparisonField({
  filters,
  label,
  onFieldChange,
  opField,
  placeholder,
  valueField,
}: FilterControlProps & NumericFilterDefinition) {
  const { text: surfaceText } = useSharedI18n();
  const translatedLabel = surfaceText(label);
  return (
    <div>
      <p className={FIELD_LABEL_CLASS}>{translatedLabel}</p>
      <div className="mt-1 grid grid-cols-5 gap-2">
        <UiSelect
          id={fieldId(opField)}
          aria-label={surfaceText("{label} operator", { label: translatedLabel })}
          value={filters[opField]}
          onChange={(event) => onFieldChange(opField, event.target.value)}
          size="compact"
          fieldClassName={PAIR_MODE_FIELD_CLASS}
          className="ui-list-control"
        >
          {NUMERIC_FILTER_OPTIONS.map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
        </UiSelect>
        <UiInput
          id={fieldId(valueField)}
          aria-label={surfaceText("{label} value", { label: translatedLabel })}
          type="number"
          min="0"
          value={filters[valueField]}
          onChange={(event) => onFieldChange(valueField, event.target.value)}
          placeholder={surfaceText(placeholder)}
          size="compact"
          fieldClassName={PAIR_VALUE_FIELD_CLASS}
          className="ui-list-control"
        />
      </div>
    </div>
  );
}

function BooleanFilterField({
  field,
  filters,
  label,
  onFieldChange,
}: FilterControlProps & BooleanFilterDefinition) {
  return (
    <SelectFilterField
      field={field}
      filters={filters}
      label={label}
      onFieldChange={onFieldChange}
      options={BOOLEAN_FILTER_OPTIONS}
    />
  );
}

export default function BucketOpsFeatureDetailFilterFields({
  filters,
  onFieldChange,
  sseFeatureEnabled,
}: BucketOpsFeatureDetailFilterFieldsProps) {
  const { text: surfaceText } = useSharedI18n();
  const controls = { filters, onFieldChange };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <FeatureDetailCard
        title={surfaceText("Lifecycle")}
        description={surfaceText("Rule name, status, type and lifecycle day conditions are evaluated on the same lifecycle rule.")}
      >
        <PresenceTextFilterField
          {...controls}
          label={surfaceText("Rule name")}
          modeField="lifecycleRuleNameMode"
          modeOptions={LIFECYCLE_RULE_NAME_MODE_OPTIONS}
          valueField="lifecycleRuleName"
          placeholder={surfaceText("rule-id")}
        />
        <SelectFilterField
          {...controls}
          field="lifecycleRuleStatus"
          label={surfaceText("Rule status")}
          options={LIFECYCLE_RULE_STATUS_OPTIONS}
        />
        <PresenceSelectFilterField
          {...controls}
          label={surfaceText("Rule type")}
          modeField="lifecycleRuleTypeMode"
          modeOptions={LIFECYCLE_RULE_TYPE_MODE_OPTIONS}
          valueField="lifecycleRuleTypeValue"
          valueOptions={LIFECYCLE_RULE_TYPE_VALUE_OPTIONS}
        />
        {LIFECYCLE_NUMERIC_FILTERS.map((definition) => (
          <NumericComparisonField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
      </FeatureDetailCard>

      <FeatureDetailCard
        title={surfaceText("Notifications")}
        description={surfaceText("Rule ID, type, topic, events and key filters are evaluated on the same notification rule.")}
      >
        <TextFilterField
          {...controls}
          field="notificationRuleId"
          label={surfaceText("Rule ID")}
          placeholder={surfaceText("rule-id")}
        />
        <PresenceSelectFilterField
          {...controls}
          label={surfaceText("Rule type")}
          modeField="notificationRuleTypeMode"
          modeOptions={PRESENCE_FILTER_OPTIONS}
          valueField="notificationRuleTypeValue"
          valueOptions={NOTIFICATION_RULE_TYPE_VALUE_OPTIONS}
        />
        <TextFilterField
          {...controls}
          field="notificationTopicName"
          label={surfaceText("Topic name or ARN")}
          placeholder={surfaceText("bucket-events")}
        />
        {NOTIFICATION_PRESENCE_FILTERS.map((definition) => (
          <PresenceTextFilterField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <BooleanFilterField
          {...controls}
          field="notificationEventBridgePresent"
          label={surfaceText("EventBridge present")}
        />
      </FeatureDetailCard>

      <FeatureDetailCard title={surfaceText("Object Lock and BPA")}>
        <SelectFilterField
          {...controls}
          field="objectLockMode"
          label={surfaceText("Object Lock mode")}
          options={OBJECT_LOCK_MODE_OPTIONS}
        />
        {OBJECT_LOCK_NUMERIC_FILTERS.map((definition) => (
          <NumericComparisonField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <div className="grid grid-cols-2 gap-2">
          {BPA_BOOLEAN_FILTERS.map((definition) => (
            <BooleanFilterField
              key={definition.field}
              {...controls}
              {...definition}
            />
          ))}
        </div>
      </FeatureDetailCard>

      <FeatureDetailCard title={surfaceText("CORS and Logging")}>
        {CORS_PRESENCE_FILTERS.map((definition) => (
          <PresenceTextFilterField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <BooleanFilterField
          {...controls}
          field="loggingEnabled"
          label={surfaceText("Logging enabled")}
        />
        <TextFilterField
          {...controls}
          field="loggingTargetBucket"
          label={surfaceText("Logging target bucket")}
          placeholder={surfaceText("audit-bucket")}
        />
        <TextFilterField
          {...controls}
          field="loggingTargetPrefix"
          label={surfaceText("Logging target prefix")}
          placeholder={surfaceText("logs/")}
        />
      </FeatureDetailCard>

      <FeatureDetailCard title={surfaceText("Website and Policy")}>
        <div className="grid grid-cols-2 gap-2">
          {WEBSITE_BOOLEAN_FILTERS.map((definition) => (
            <BooleanFilterField
              key={definition.field}
              {...controls}
              {...definition}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextFilterField
            {...controls}
            field="websiteIndexDocument"
            label={surfaceText("Website index document")}
            placeholder={surfaceText("index.html")}
          />
          <TextFilterField
            {...controls}
            field="websiteErrorDocument"
            label={surfaceText("Website error document")}
            placeholder={surfaceText("error.html")}
          />
        </div>
        <TextFilterField
          {...controls}
          field="websiteRedirectHost"
          label={surfaceText("Website redirect host")}
          placeholder={surfaceText("www.example.test")}
        />
        {WEBSITE_NUMERIC_FILTERS.map((definition) => (
          <NumericComparisonField
            key={definition.valueField}
            {...controls}
            {...definition}
          />
        ))}
        <BooleanFilterField
          {...controls}
          field="policyHasConditions"
          label={surfaceText("Policy has conditions")}
        />
      </FeatureDetailCard>

      <FeatureDetailCard
        title={surfaceText("Server-side encryption")}
        disabled={!sseFeatureEnabled}
      >
        {!sseFeatureEnabled && (
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {surfaceText("Server-side encryption is disabled on this endpoint.")}</p>
        )}
        <TextFilterField
          {...controls}
          field="sseAlgorithm"
          label={surfaceText("SSE algorithm")}
          placeholder={surfaceText("AES256")}
          disabled={!sseFeatureEnabled}
        />
        <TextFilterField
          {...controls}
          field="sseKmsKeyId"
          label={surfaceText("SSE KMS key ID")}
          placeholder={surfaceText("key-id or ARN")}
          disabled={!sseFeatureEnabled}
        />
      </FeatureDetailCard>
    </div>
  );
}
