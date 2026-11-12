export type BucketTextFilterField =
  | "name"
  | "tenant"
  | "owner"
  | "owner_name"
  | "owner_kind"
  | "context_id"
  | "context_name"
  | "context_kind"
  | "endpoint_name"
  | "bucket_identity";

export type BucketBooleanFilterField = "owner_suspended";

export type BucketNumericFilterField =
  | "used_bytes"
  | "object_count"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "quota_usage_size_percent"
  | "quota_usage_object_percent"
  | "owner_used_bytes"
  | "owner_object_count"
  | "owner_quota_max_size_bytes"
  | "owner_quota_max_objects"
  | "owner_quota_usage_size_percent"
  | "owner_quota_usage_object_percent";

export type BucketFilterField =
  | BucketTextFilterField
  | BucketBooleanFilterField
  | BucketNumericFilterField
  | "tag";

export type BucketFeatureKey =
  | "versioning"
  | "object_lock"
  | "block_public_access"
  | "lifecycle_rules"
  | "static_website"
  | "bucket_policy"
  | "cors"
  | "access_logging"
  | "notifications"
  | "server_side_encryption";

export type BucketFeatureState =
  | "enabled"
  | "disabled"
  | "disabled_or_suspended"
  | "unknown"
  | "partial"
  | "suspended"
  | "configured"
  | "not_set"
  | "unavailable";

export type BucketFeatureParam =
  | "lifecycle_rule_id"
  | "lifecycle_rule_status"
  | "lifecycle_rule_type"
  | "lifecycle_expiration_days"
  | "lifecycle_noncurrent_expiration_days"
  | "lifecycle_transition_days"
  | "lifecycle_abort_multipart_present"
  | "lifecycle_abort_multipart_days"
  | "object_lock_mode"
  | "object_lock_retention_days"
  | "object_lock_retention_years"
  | "bpa_block_public_acls"
  | "bpa_ignore_public_acls"
  | "bpa_block_public_policy"
  | "bpa_restrict_public_buckets"
  | "cors_allowed_method"
  | "cors_allowed_origin"
  | "logging_enabled"
  | "logging_target_bucket"
  | "logging_target_prefix"
  | "website_index_present"
  | "website_index_document"
  | "website_error_document"
  | "website_redirect_host_present"
  | "website_redirect_host"
  | "website_routing_rule_count"
  | "policy_statement_count"
  | "policy_has_conditions"
  | "notification_rule_id"
  | "notification_rule_type"
  | "notification_topic_name"
  | "notification_event"
  | "notification_filter_prefix"
  | "notification_filter_suffix"
  | "notification_eventbridge_present"
  | "sse_algorithm"
  | "sse_kms_key_id";

type BucketFilterScalar = string | number | boolean;
type BucketNullRule<Field extends BucketFilterField> = {
  field: Field;
  op: "is_null" | "not_null";
  value?: never;
};
type BucketListRule<Field extends BucketFilterField> = {
  field: Field;
  op: "in" | "not_in";
  value: BucketFilterScalar[];
};

export type BucketFieldFilterRule =
  | BucketNullRule<BucketTextFilterField | BucketBooleanFilterField | BucketNumericFilterField>
  | BucketListRule<BucketTextFilterField | BucketBooleanFilterField | BucketNumericFilterField | "tag">
  | {
      field: BucketTextFilterField | "tag";
      op: "eq" | "neq" | "contains" | "starts_with" | "ends_with";
      value: BucketFilterScalar;
    }
  | {
      field: BucketBooleanFilterField;
      op: "eq" | "neq";
      value: BucketFilterScalar;
    }
  | {
      field: BucketNumericFilterField;
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value: BucketFilterScalar;
    };

export type BucketFeatureStateFilterRule = {
  feature: BucketFeatureKey;
  state: BucketFeatureState;
};

export type BucketFeatureParamFilterRule = {
  feature: BucketFeatureKey;
  param: BucketFeatureParam;
  op:
    | "eq"
    | "neq"
    | "contains"
    | "starts_with"
    | "ends_with"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "has"
    | "has_not";
  value?: BucketFilterScalar;
  quantifier?: "any" | "none";
};

export type BucketFilterRule =
  | BucketFieldFilterRule
  | BucketFeatureStateFilterRule
  | BucketFeatureParamFilterRule;

export type BucketFilterMatch = "all" | "any";

export const serializeBucketFilterRules = (
  rules: readonly BucketFilterRule[],
  match: BucketFilterMatch = "all",
): string => JSON.stringify({ match, rules });
