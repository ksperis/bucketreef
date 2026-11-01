export type FeatureTriState = "any" | "true" | "false";
export type NumericComparisonOpUi = "=" | "!=" | ">" | ">=" | "<" | "<=";
export type LifecycleRuleNameMode = "any" | "has_named" | "has_not_named";
export type LifecycleRuleStatusValue = "" | "Enabled" | "Disabled";
export type PresenceMode = "any" | "has" | "has_not";
export type LifecycleRuleTypeValue =
  | ""
  | "expiration"
  | "delete_markers"
  | "noncurrent_expiration"
  | "abort_multipart"
  | "transition"
  | "noncurrent_transition";
export type NotificationRuleTypeValue = "" | "topic" | "queue" | "lambda";

export type FeatureDetailFilters = {
  lifecycleRuleNameMode: LifecycleRuleNameMode;
  lifecycleRuleName: string;
  lifecycleRuleStatus: LifecycleRuleStatusValue;
  lifecycleRuleTypeMode: PresenceMode;
  lifecycleRuleTypeValue: LifecycleRuleTypeValue;
  lifecycleExpirationDaysOp: NumericComparisonOpUi;
  lifecycleExpirationDays: string;
  lifecycleNoncurrentExpirationDaysOp: NumericComparisonOpUi;
  lifecycleNoncurrentExpirationDays: string;
  lifecycleTransitionDaysOp: NumericComparisonOpUi;
  lifecycleTransitionDays: string;
  lifecycleAbortDaysOp: NumericComparisonOpUi;
  lifecycleAbortDays: string;
  objectLockMode: "" | "GOVERNANCE" | "COMPLIANCE";
  objectLockRetentionOp: NumericComparisonOpUi;
  objectLockRetentionDays: string;
  objectLockRetentionYearsOp: NumericComparisonOpUi;
  objectLockRetentionYears: string;
  bpaBlockPublicAcls: FeatureTriState;
  bpaIgnorePublicAcls: FeatureTriState;
  bpaBlockPublicPolicy: FeatureTriState;
  bpaRestrictPublicBuckets: FeatureTriState;
  corsMethodMode: PresenceMode;
  corsMethodValue: string;
  corsOriginMode: PresenceMode;
  corsOriginValue: string;
  loggingEnabled: FeatureTriState;
  loggingTargetBucket: string;
  loggingTargetPrefix: string;
  websiteIndexPresent: FeatureTriState;
  websiteIndexDocument: string;
  websiteErrorDocument: string;
  websiteRedirectHostPresent: FeatureTriState;
  websiteRedirectHost: string;
  websiteRoutingRuleCountOp: NumericComparisonOpUi;
  websiteRoutingRuleCount: string;
  policyStatementOp: NumericComparisonOpUi;
  policyStatementCount: string;
  policyHasConditions: FeatureTriState;
  notificationRuleId: string;
  notificationRuleTypeMode: PresenceMode;
  notificationRuleTypeValue: NotificationRuleTypeValue;
  notificationTopicName: string;
  notificationEventMode: PresenceMode;
  notificationEventValue: string;
  notificationFilterPrefixMode: PresenceMode;
  notificationFilterPrefixValue: string;
  notificationFilterSuffixMode: PresenceMode;
  notificationFilterSuffixValue: string;
  notificationEventBridgePresent: FeatureTriState;
  sseAlgorithm: string;
  sseKmsKeyId: string;
};
export type FeatureDetailFilterKey = keyof FeatureDetailFilters;

export const defaultFeatureDetailFilters: FeatureDetailFilters = {
  lifecycleRuleNameMode: "any",
  lifecycleRuleName: "",
  lifecycleRuleStatus: "",
  lifecycleRuleTypeMode: "any",
  lifecycleRuleTypeValue: "",
  lifecycleExpirationDaysOp: "=",
  lifecycleExpirationDays: "",
  lifecycleNoncurrentExpirationDaysOp: "=",
  lifecycleNoncurrentExpirationDays: "",
  lifecycleTransitionDaysOp: "=",
  lifecycleTransitionDays: "",
  lifecycleAbortDaysOp: "=",
  lifecycleAbortDays: "",
  objectLockMode: "",
  objectLockRetentionOp: ">=",
  objectLockRetentionDays: "",
  objectLockRetentionYearsOp: ">=",
  objectLockRetentionYears: "",
  bpaBlockPublicAcls: "any",
  bpaIgnorePublicAcls: "any",
  bpaBlockPublicPolicy: "any",
  bpaRestrictPublicBuckets: "any",
  corsMethodMode: "any",
  corsMethodValue: "",
  corsOriginMode: "any",
  corsOriginValue: "",
  loggingEnabled: "any",
  loggingTargetBucket: "",
  loggingTargetPrefix: "",
  websiteIndexPresent: "any",
  websiteIndexDocument: "",
  websiteErrorDocument: "",
  websiteRedirectHostPresent: "any",
  websiteRedirectHost: "",
  websiteRoutingRuleCountOp: ">=",
  websiteRoutingRuleCount: "",
  policyStatementOp: ">=",
  policyStatementCount: "",
  policyHasConditions: "any",
  notificationRuleId: "",
  notificationRuleTypeMode: "any",
  notificationRuleTypeValue: "",
  notificationTopicName: "",
  notificationEventMode: "any",
  notificationEventValue: "",
  notificationFilterPrefixMode: "any",
  notificationFilterPrefixValue: "",
  notificationFilterSuffixMode: "any",
  notificationFilterSuffixValue: "",
  notificationEventBridgePresent: "any",
  sseAlgorithm: "",
  sseKmsKeyId: "",
};

const NUMERIC_UI_TO_RULE_OP: Record<NumericComparisonOpUi, "eq" | "neq" | "gt" | "gte" | "lt" | "lte"> = {
  "=": "eq",
  "!=": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

const TRI_STATES: FeatureTriState[] = ["any", "true", "false"];
const LIFECYCLE_NAME_MODES: LifecycleRuleNameMode[] = ["any", "has_named", "has_not_named"];
const LIFECYCLE_RULE_STATUSES: Exclude<LifecycleRuleStatusValue, "">[] = ["Enabled", "Disabled"];
const PRESENCE_MODES: PresenceMode[] = ["any", "has", "has_not"];
const NUMERIC_UI_OPS: NumericComparisonOpUi[] = ["=", "!=", ">", ">=", "<", "<="];
const LIFECYCLE_RULE_TYPES: Exclude<LifecycleRuleTypeValue, "">[] = [
  "expiration",
  "delete_markers",
  "noncurrent_expiration",
  "abort_multipart",
  "transition",
  "noncurrent_transition",
];
const LIFECYCLE_RULE_TYPE_LABELS: Record<Exclude<LifecycleRuleTypeValue, "">, string> = {
  expiration: "Expiration (current versions)",
  delete_markers: "Expired object delete markers",
  noncurrent_expiration: "Expiration (noncurrent versions)",
  abort_multipart: "Abort incomplete multipart uploads",
  transition: "Transitions",
  noncurrent_transition: "Noncurrent transitions",
};
const NOTIFICATION_RULE_TYPES: Exclude<NotificationRuleTypeValue, "">[] = ["topic", "queue", "lambda"];
const OBJECT_LOCK_MODES = ["", "GOVERNANCE", "COMPLIANCE"] as const;
export const notificationFeatureDetailFilterKeys: FeatureDetailFilterKey[] = [
  "notificationRuleId",
  "notificationRuleTypeMode",
  "notificationRuleTypeValue",
  "notificationTopicName",
  "notificationEventMode",
  "notificationEventValue",
  "notificationFilterPrefixMode",
  "notificationFilterPrefixValue",
  "notificationFilterSuffixMode",
  "notificationFilterSuffixValue",
  "notificationEventBridgePresent",
];
export const sseFeatureDetailFilterKeys: FeatureDetailFilterKey[] = ["sseAlgorithm", "sseKmsKeyId"];

const asString = (value: unknown) => (typeof value === "string" ? value : "");
const sanitizeChoice = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => allowed.includes(value as T) ? (value as T) : fallback;

export const sanitizeFeatureDetailFilters = (value: unknown): FeatureDetailFilters => {
  if (!value || typeof value !== "object") return { ...defaultFeatureDetailFilters };
  const raw = value as Partial<FeatureDetailFilters>;
  const lifecycleRuleNameMode = sanitizeChoice(raw.lifecycleRuleNameMode, LIFECYCLE_NAME_MODES, defaultFeatureDetailFilters.lifecycleRuleNameMode);
  const lifecycleRuleStatus = sanitizeChoice(raw.lifecycleRuleStatus, LIFECYCLE_RULE_STATUSES, defaultFeatureDetailFilters.lifecycleRuleStatus);
  const lifecycleRuleTypeMode = sanitizeChoice(raw.lifecycleRuleTypeMode, PRESENCE_MODES, defaultFeatureDetailFilters.lifecycleRuleTypeMode);
  const lifecycleRuleTypeValue = sanitizeChoice(raw.lifecycleRuleTypeValue, LIFECYCLE_RULE_TYPES, defaultFeatureDetailFilters.lifecycleRuleTypeValue);
  const lifecycleExpirationDaysOp = sanitizeChoice(raw.lifecycleExpirationDaysOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.lifecycleExpirationDaysOp);
  const lifecycleNoncurrentExpirationDaysOp = sanitizeChoice(raw.lifecycleNoncurrentExpirationDaysOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.lifecycleNoncurrentExpirationDaysOp);
  const lifecycleTransitionDaysOp = sanitizeChoice(raw.lifecycleTransitionDaysOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.lifecycleTransitionDaysOp);
  const lifecycleAbortDaysOp = sanitizeChoice(raw.lifecycleAbortDaysOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.lifecycleAbortDaysOp);
  const objectLockMode = sanitizeChoice(raw.objectLockMode, OBJECT_LOCK_MODES, defaultFeatureDetailFilters.objectLockMode);
  const objectLockRetentionOp = sanitizeChoice(raw.objectLockRetentionOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.objectLockRetentionOp);
  const objectLockRetentionYearsOp = sanitizeChoice(raw.objectLockRetentionYearsOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.objectLockRetentionYearsOp);
  const corsMethodMode = sanitizeChoice(raw.corsMethodMode, PRESENCE_MODES, defaultFeatureDetailFilters.corsMethodMode);
  const corsOriginMode = sanitizeChoice(raw.corsOriginMode, PRESENCE_MODES, defaultFeatureDetailFilters.corsOriginMode);
  const loggingEnabled = sanitizeChoice(raw.loggingEnabled, TRI_STATES, defaultFeatureDetailFilters.loggingEnabled);
  const websiteIndexPresent = sanitizeChoice(raw.websiteIndexPresent, TRI_STATES, defaultFeatureDetailFilters.websiteIndexPresent);
  const websiteRedirectHostPresent = sanitizeChoice(raw.websiteRedirectHostPresent, TRI_STATES, defaultFeatureDetailFilters.websiteRedirectHostPresent);
  const websiteRoutingRuleCountOp = sanitizeChoice(raw.websiteRoutingRuleCountOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.websiteRoutingRuleCountOp);
  const policyStatementOp = sanitizeChoice(raw.policyStatementOp, NUMERIC_UI_OPS, defaultFeatureDetailFilters.policyStatementOp);
  const policyHasConditions = sanitizeChoice(raw.policyHasConditions, TRI_STATES, defaultFeatureDetailFilters.policyHasConditions);
  const notificationRuleTypeMode = sanitizeChoice(raw.notificationRuleTypeMode, PRESENCE_MODES, defaultFeatureDetailFilters.notificationRuleTypeMode);
  const notificationRuleTypeValue = sanitizeChoice(raw.notificationRuleTypeValue, NOTIFICATION_RULE_TYPES, defaultFeatureDetailFilters.notificationRuleTypeValue);
  const notificationEventMode = sanitizeChoice(raw.notificationEventMode, PRESENCE_MODES, defaultFeatureDetailFilters.notificationEventMode);
  const notificationFilterPrefixMode = sanitizeChoice(raw.notificationFilterPrefixMode, PRESENCE_MODES, defaultFeatureDetailFilters.notificationFilterPrefixMode);
  const notificationFilterSuffixMode = sanitizeChoice(raw.notificationFilterSuffixMode, PRESENCE_MODES, defaultFeatureDetailFilters.notificationFilterSuffixMode);

  return {
    lifecycleRuleNameMode,
    lifecycleRuleName: asString(raw.lifecycleRuleName),
    lifecycleRuleStatus,
    lifecycleRuleTypeMode,
    lifecycleRuleTypeValue,
    lifecycleExpirationDaysOp,
    lifecycleExpirationDays: asString(raw.lifecycleExpirationDays),
    lifecycleNoncurrentExpirationDaysOp,
    lifecycleNoncurrentExpirationDays: asString(raw.lifecycleNoncurrentExpirationDays),
    lifecycleTransitionDaysOp,
    lifecycleTransitionDays: asString(raw.lifecycleTransitionDays),
    lifecycleAbortDaysOp,
    lifecycleAbortDays: asString(raw.lifecycleAbortDays),
    objectLockMode,
    objectLockRetentionOp,
    objectLockRetentionDays: asString(raw.objectLockRetentionDays),
    objectLockRetentionYearsOp,
    objectLockRetentionYears: asString(raw.objectLockRetentionYears),
    bpaBlockPublicAcls: sanitizeChoice(raw.bpaBlockPublicAcls, TRI_STATES, "any"),
    bpaIgnorePublicAcls: sanitizeChoice(raw.bpaIgnorePublicAcls, TRI_STATES, "any"),
    bpaBlockPublicPolicy: sanitizeChoice(raw.bpaBlockPublicPolicy, TRI_STATES, "any"),
    bpaRestrictPublicBuckets: sanitizeChoice(raw.bpaRestrictPublicBuckets, TRI_STATES, "any"),
    corsMethodMode,
    corsMethodValue: asString(raw.corsMethodValue),
    corsOriginMode,
    corsOriginValue: asString(raw.corsOriginValue),
    loggingEnabled,
    loggingTargetBucket: asString(raw.loggingTargetBucket),
    loggingTargetPrefix: asString(raw.loggingTargetPrefix),
    websiteIndexPresent,
    websiteIndexDocument: asString(raw.websiteIndexDocument),
    websiteErrorDocument: asString(raw.websiteErrorDocument),
    websiteRedirectHostPresent,
    websiteRedirectHost: asString(raw.websiteRedirectHost),
    websiteRoutingRuleCountOp,
    websiteRoutingRuleCount: asString(raw.websiteRoutingRuleCount),
    policyStatementOp,
    policyStatementCount: asString(raw.policyStatementCount),
    policyHasConditions,
    notificationRuleId: asString(raw.notificationRuleId),
    notificationRuleTypeMode,
    notificationRuleTypeValue,
    notificationTopicName: asString(raw.notificationTopicName),
    notificationEventMode,
    notificationEventValue: asString(raw.notificationEventValue),
    notificationFilterPrefixMode,
    notificationFilterPrefixValue: asString(raw.notificationFilterPrefixValue),
    notificationFilterSuffixMode,
    notificationFilterSuffixValue: asString(raw.notificationFilterSuffixValue),
    notificationEventBridgePresent: sanitizeChoice(raw.notificationEventBridgePresent, TRI_STATES, "any"),
    sseAlgorithm: asString(raw.sseAlgorithm),
    sseKmsKeyId: asString(raw.sseKmsKeyId),
  };
};

const pushTriStateRule = (
  rules: Array<Record<string, unknown>>,
  triState: FeatureTriState,
  feature: string,
  param: string
) => {
  if (triState === "any") return;
  rules.push({ feature, param, op: "eq", value: triState === "true" });
};

const pushNumericRule = (
  rules: Array<Record<string, unknown>>,
  rawValue: string,
  op: NumericComparisonOpUi,
  feature: string,
  param: string,
) => {
  const trimmed = rawValue.trim();
  if (!trimmed) return;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return;
  rules.push({ feature, param, op: NUMERIC_UI_TO_RULE_OP[op], value });
};

const pushTextRule = (
  rules: Array<Record<string, unknown>>,
  rawValue: string,
  feature: string,
  param: string,
  op: "eq" | "contains" = "contains",
) => {
  const value = rawValue.trim();
  if (!value) return;
  rules.push({ feature, param, op, value });
};

const pushPresenceRule = (
  rules: Array<Record<string, unknown>>,
  mode: PresenceMode,
  rawValue: string,
  feature: string,
  param: string,
) => {
  if (mode === "any") return;
  const value = rawValue.trim();
  if (!value) return;
  rules.push({ feature, param, op: mode === "has" ? "has" : "has_not", value });
};

export const buildFeatureDetailRules = (
  filters: FeatureDetailFilters,
  featureSupport: Partial<Record<string, boolean>> = {}
): Array<Record<string, unknown>> => {
  const rules: Array<Record<string, unknown>> = [];
  const lifecycleRuleName = filters.lifecycleRuleName.trim();
  if (filters.lifecycleRuleNameMode !== "any" && lifecycleRuleName) {
    const rule: Record<string, unknown> = {
      feature: "lifecycle_rules",
      param: "lifecycle_rule_id",
      op: "eq",
      value: lifecycleRuleName,
    };
    if (filters.lifecycleRuleNameMode === "has_not_named") {
      rule.quantifier = "none";
    }
    rules.push(rule);
  }

  if (filters.lifecycleRuleStatus) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_rule_status",
      op: "eq",
      value: filters.lifecycleRuleStatus,
    });
  }

  if (filters.lifecycleRuleTypeMode !== "any" && filters.lifecycleRuleTypeValue) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_rule_type",
      op: filters.lifecycleRuleTypeMode === "has" ? "has" : "has_not",
      value: filters.lifecycleRuleTypeValue,
    });
  }

  pushNumericRule(rules, filters.lifecycleExpirationDays, filters.lifecycleExpirationDaysOp, "lifecycle_rules", "lifecycle_expiration_days");
  pushNumericRule(rules, filters.lifecycleNoncurrentExpirationDays, filters.lifecycleNoncurrentExpirationDaysOp, "lifecycle_rules", "lifecycle_noncurrent_expiration_days");
  pushNumericRule(rules, filters.lifecycleTransitionDays, filters.lifecycleTransitionDaysOp, "lifecycle_rules", "lifecycle_transition_days");
  pushNumericRule(rules, filters.lifecycleAbortDays, filters.lifecycleAbortDaysOp, "lifecycle_rules", "lifecycle_abort_multipart_days");

  if (filters.objectLockMode) {
    rules.push({
      feature: "object_lock",
      param: "object_lock_mode",
      op: "eq",
      value: filters.objectLockMode,
    });
  }
  pushNumericRule(rules, filters.objectLockRetentionDays, filters.objectLockRetentionOp, "object_lock", "object_lock_retention_days");
  pushNumericRule(rules, filters.objectLockRetentionYears, filters.objectLockRetentionYearsOp, "object_lock", "object_lock_retention_years");

  pushTriStateRule(rules, filters.bpaBlockPublicAcls, "block_public_access", "bpa_block_public_acls");
  pushTriStateRule(rules, filters.bpaIgnorePublicAcls, "block_public_access", "bpa_ignore_public_acls");
  pushTriStateRule(rules, filters.bpaBlockPublicPolicy, "block_public_access", "bpa_block_public_policy");
  pushTriStateRule(rules, filters.bpaRestrictPublicBuckets, "block_public_access", "bpa_restrict_public_buckets");

  pushPresenceRule(rules, filters.corsMethodMode, filters.corsMethodValue, "cors", "cors_allowed_method");
  pushPresenceRule(rules, filters.corsOriginMode, filters.corsOriginValue, "cors", "cors_allowed_origin");
  pushTriStateRule(rules, filters.loggingEnabled, "access_logging", "logging_enabled");
  pushTextRule(rules, filters.loggingTargetBucket, "access_logging", "logging_target_bucket", "eq");
  pushTextRule(rules, filters.loggingTargetPrefix, "access_logging", "logging_target_prefix");

  pushTriStateRule(rules, filters.websiteIndexPresent, "static_website", "website_index_present");
  pushTextRule(rules, filters.websiteIndexDocument, "static_website", "website_index_document");
  pushTextRule(rules, filters.websiteErrorDocument, "static_website", "website_error_document");
  pushTriStateRule(rules, filters.websiteRedirectHostPresent, "static_website", "website_redirect_host_present");
  pushTextRule(rules, filters.websiteRedirectHost, "static_website", "website_redirect_host");
  pushNumericRule(rules, filters.websiteRoutingRuleCount, filters.websiteRoutingRuleCountOp, "static_website", "website_routing_rule_count");
  pushNumericRule(rules, filters.policyStatementCount, filters.policyStatementOp, "bucket_policy", "policy_statement_count");
  pushTriStateRule(rules, filters.policyHasConditions, "bucket_policy", "policy_has_conditions");

  if (featureSupport.notifications !== false) {
    pushTextRule(rules, filters.notificationRuleId, "notifications", "notification_rule_id");

    if (filters.notificationRuleTypeMode !== "any" && filters.notificationRuleTypeValue) {
      rules.push({
        feature: "notifications",
        param: "notification_rule_type",
        op: filters.notificationRuleTypeMode === "has" ? "has" : "has_not",
        value: filters.notificationRuleTypeValue,
      });
    }

    pushTextRule(rules, filters.notificationTopicName, "notifications", "notification_topic_name");
    pushPresenceRule(rules, filters.notificationEventMode, filters.notificationEventValue, "notifications", "notification_event");
    pushPresenceRule(rules, filters.notificationFilterPrefixMode, filters.notificationFilterPrefixValue, "notifications", "notification_filter_prefix");
    pushPresenceRule(rules, filters.notificationFilterSuffixMode, filters.notificationFilterSuffixValue, "notifications", "notification_filter_suffix");
    pushTriStateRule(rules, filters.notificationEventBridgePresent, "notifications", "notification_eventbridge_present");
  }

  if (featureSupport.server_side_encryption !== false) {
    pushTextRule(rules, filters.sseAlgorithm, "server_side_encryption", "sse_algorithm");
    pushTextRule(rules, filters.sseKmsKeyId, "server_side_encryption", "sse_kms_key_id");
  }

  return rules;
};

export const hasFeatureDetailFilters = (
  filters: FeatureDetailFilters,
  featureSupport: Partial<Record<string, boolean>> = {}
): boolean => buildFeatureDetailRules(filters, featureSupport).length > 0;

export const featureDetailSummaryItems = (
  filters: FeatureDetailFilters
): Array<{ field: FeatureDetailFilterKey; label: string }> => {
  const summary: Array<{ field: FeatureDetailFilterKey; label: string }> = [];
  const lifecycleRuleName = filters.lifecycleRuleName.trim();
  if (filters.lifecycleRuleNameMode === "has_named" && lifecycleRuleName) {
    summary.push({ field: "lifecycleRuleName", label: `Lifecycle rule name: ${lifecycleRuleName}` });
  }
  if (filters.lifecycleRuleNameMode === "has_not_named" && lifecycleRuleName) {
    summary.push({ field: "lifecycleRuleName", label: `Lifecycle rule name absent: ${lifecycleRuleName}` });
  }
  if (filters.lifecycleRuleStatus) {
    summary.push({ field: "lifecycleRuleStatus", label: `Lifecycle rule status: ${filters.lifecycleRuleStatus}` });
  }
  if (filters.lifecycleRuleTypeMode !== "any" && filters.lifecycleRuleTypeValue) {
    const typeLabel = LIFECYCLE_RULE_TYPE_LABELS[filters.lifecycleRuleTypeValue] ?? filters.lifecycleRuleTypeValue;
    summary.push({
      field: "lifecycleRuleTypeValue",
      label: `Lifecycle rule type ${filters.lifecycleRuleTypeMode}: ${typeLabel}`,
    });
  }
  if (filters.lifecycleAbortDays.trim()) {
    summary.push({
      field: "lifecycleAbortDays",
      label: `Lifecycle abort days ${filters.lifecycleAbortDaysOp} ${filters.lifecycleAbortDays.trim()}`,
    });
  }
  if (filters.lifecycleExpirationDays.trim()) {
    summary.push({
      field: "lifecycleExpirationDays",
      label: `Lifecycle expiration days ${filters.lifecycleExpirationDaysOp} ${filters.lifecycleExpirationDays.trim()}`,
    });
  }
  if (filters.lifecycleNoncurrentExpirationDays.trim()) {
    summary.push({
      field: "lifecycleNoncurrentExpirationDays",
      label: `Lifecycle noncurrent expiration days ${filters.lifecycleNoncurrentExpirationDaysOp} ${filters.lifecycleNoncurrentExpirationDays.trim()}`,
    });
  }
  if (filters.lifecycleTransitionDays.trim()) {
    summary.push({
      field: "lifecycleTransitionDays",
      label: `Lifecycle transition days ${filters.lifecycleTransitionDaysOp} ${filters.lifecycleTransitionDays.trim()}`,
    });
  }
  if (filters.objectLockMode) summary.push({ field: "objectLockMode", label: `Object Lock mode: ${filters.objectLockMode}` });
  if (filters.objectLockRetentionDays.trim()) {
    summary.push({
      field: "objectLockRetentionDays",
      label: `Object Lock retention days ${filters.objectLockRetentionOp} ${filters.objectLockRetentionDays.trim()}`,
    });
  }
  if (filters.objectLockRetentionYears.trim()) {
    summary.push({
      field: "objectLockRetentionYears",
      label: `Object Lock retention years ${filters.objectLockRetentionYearsOp} ${filters.objectLockRetentionYears.trim()}`,
    });
  }
  if (filters.bpaBlockPublicAcls !== "any") {
    summary.push({ field: "bpaBlockPublicAcls", label: `BPA block public ACLs: ${filters.bpaBlockPublicAcls}` });
  }
  if (filters.bpaIgnorePublicAcls !== "any") {
    summary.push({ field: "bpaIgnorePublicAcls", label: `BPA ignore public ACLs: ${filters.bpaIgnorePublicAcls}` });
  }
  if (filters.bpaBlockPublicPolicy !== "any") {
    summary.push({ field: "bpaBlockPublicPolicy", label: `BPA block public policy: ${filters.bpaBlockPublicPolicy}` });
  }
  if (filters.bpaRestrictPublicBuckets !== "any") {
    summary.push({ field: "bpaRestrictPublicBuckets", label: `BPA restrict public buckets: ${filters.bpaRestrictPublicBuckets}` });
  }
  if (filters.corsMethodMode !== "any" && filters.corsMethodValue.trim()) {
    summary.push({ field: "corsMethodValue", label: `CORS method ${filters.corsMethodMode}: ${filters.corsMethodValue.trim()}` });
  }
  if (filters.corsOriginMode !== "any" && filters.corsOriginValue.trim()) {
    summary.push({ field: "corsOriginValue", label: `CORS origin ${filters.corsOriginMode}: ${filters.corsOriginValue.trim()}` });
  }
  if (filters.loggingEnabled !== "any") summary.push({ field: "loggingEnabled", label: `Logging enabled: ${filters.loggingEnabled}` });
  if (filters.loggingTargetBucket.trim()) {
    summary.push({ field: "loggingTargetBucket", label: `Logging target bucket: ${filters.loggingTargetBucket.trim()}` });
  }
  if (filters.loggingTargetPrefix.trim()) {
    summary.push({ field: "loggingTargetPrefix", label: `Logging target prefix contains: ${filters.loggingTargetPrefix.trim()}` });
  }
  if (filters.websiteIndexPresent !== "any") {
    summary.push({ field: "websiteIndexPresent", label: `Website index present: ${filters.websiteIndexPresent}` });
  }
  if (filters.websiteIndexDocument.trim()) {
    summary.push({ field: "websiteIndexDocument", label: `Website index document contains: ${filters.websiteIndexDocument.trim()}` });
  }
  if (filters.websiteErrorDocument.trim()) {
    summary.push({ field: "websiteErrorDocument", label: `Website error document contains: ${filters.websiteErrorDocument.trim()}` });
  }
  if (filters.websiteRedirectHostPresent !== "any") {
    summary.push({
      field: "websiteRedirectHostPresent",
      label: `Website redirect host present: ${filters.websiteRedirectHostPresent}`,
    });
  }
  if (filters.websiteRedirectHost.trim()) {
    summary.push({ field: "websiteRedirectHost", label: `Website redirect host contains: ${filters.websiteRedirectHost.trim()}` });
  }
  if (filters.websiteRoutingRuleCount.trim()) {
    summary.push({
      field: "websiteRoutingRuleCount",
      label: `Website routing rules ${filters.websiteRoutingRuleCountOp} ${filters.websiteRoutingRuleCount.trim()}`,
    });
  }
  if (filters.policyStatementCount.trim()) {
    summary.push({
      field: "policyStatementCount",
      label: `Policy statements ${filters.policyStatementOp} ${filters.policyStatementCount.trim()}`,
    });
  }
  if (filters.policyHasConditions !== "any") {
    summary.push({ field: "policyHasConditions", label: `Policy has conditions: ${filters.policyHasConditions}` });
  }
  if (filters.notificationRuleId.trim()) {
    summary.push({ field: "notificationRuleId", label: `Notification rule ID contains: ${filters.notificationRuleId.trim()}` });
  }
  if (filters.notificationRuleTypeMode !== "any" && filters.notificationRuleTypeValue) {
    summary.push({
      field: "notificationRuleTypeValue",
      label: `Notification rule type ${filters.notificationRuleTypeMode}: ${filters.notificationRuleTypeValue}`,
    });
  }
  if (filters.notificationTopicName.trim()) {
    summary.push({ field: "notificationTopicName", label: `Notification topic contains: ${filters.notificationTopicName.trim()}` });
  }
  if (filters.notificationEventMode !== "any" && filters.notificationEventValue.trim()) {
    summary.push({
      field: "notificationEventValue",
      label: `Notification event ${filters.notificationEventMode}: ${filters.notificationEventValue.trim()}`,
    });
  }
  if (filters.notificationFilterPrefixMode !== "any" && filters.notificationFilterPrefixValue.trim()) {
    summary.push({
      field: "notificationFilterPrefixValue",
      label: `Notification prefix ${filters.notificationFilterPrefixMode}: ${filters.notificationFilterPrefixValue.trim()}`,
    });
  }
  if (filters.notificationFilterSuffixMode !== "any" && filters.notificationFilterSuffixValue.trim()) {
    summary.push({
      field: "notificationFilterSuffixValue",
      label: `Notification suffix ${filters.notificationFilterSuffixMode}: ${filters.notificationFilterSuffixValue.trim()}`,
    });
  }
  if (filters.notificationEventBridgePresent !== "any") {
    summary.push({
      field: "notificationEventBridgePresent",
      label: `Notification EventBridge present: ${filters.notificationEventBridgePresent}`,
    });
  }
  if (filters.sseAlgorithm.trim()) {
    summary.push({ field: "sseAlgorithm", label: `SSE algorithm contains: ${filters.sseAlgorithm.trim()}` });
  }
  if (filters.sseKmsKeyId.trim()) {
    summary.push({ field: "sseKmsKeyId", label: `SSE KMS key contains: ${filters.sseKmsKeyId.trim()}` });
  }
  return summary;
};

export const featureDetailSummary = (filters: FeatureDetailFilters): string[] => {
  return featureDetailSummaryItems(filters).map((item) => item.label);
};

export const clearFeatureDetailField = (filters: FeatureDetailFilters, key: FeatureDetailFilterKey): FeatureDetailFilters => ({
  ...filters,
  [key]: defaultFeatureDetailFilters[key],
});
