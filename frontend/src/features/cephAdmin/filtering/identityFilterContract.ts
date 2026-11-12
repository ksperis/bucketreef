export type CephAdminAccountTextFilterField =
  | "account_id"
  | "account_name"
  | "email";

export type CephAdminAccountNumericFilterField =
  | "max_users"
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "quota_usage_size_percent"
  | "quota_usage_object_percent"
  | "bucket_count"
  | "user_count";

export type CephAdminUserTextFilterField =
  | "uid"
  | "tenant"
  | "account_id"
  | "account_name"
  | "full_name"
  | "email";

export type CephAdminUserNumericFilterField =
  | "max_buckets"
  | "quota_max_size_bytes"
  | "quota_max_objects"
  | "quota_usage_size_percent"
  | "quota_usage_object_percent";

export type CephAdminUserBooleanFilterField = "suspended";

type FilterScalar = string | number | boolean;
type NullRule<Field extends string> = {
  field: Field;
  op: "is_null" | "not_null";
  value?: never;
};
type ListRule<Field extends string> = {
  field: Field;
  op: "in" | "not_in";
  value: FilterScalar[];
};
type TextRule<Field extends string> =
  | NullRule<Field>
  | ListRule<Field>
  | {
      field: Field;
      op: "eq" | "neq" | "contains" | "starts_with" | "ends_with";
      value: FilterScalar;
    };
type NumericRule<Field extends string> =
  | NullRule<Field>
  | ListRule<Field>
  | {
      field: Field;
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value: FilterScalar;
    };
type BooleanRule<Field extends string> =
  | NullRule<Field>
  | ListRule<Field>
  | {
      field: Field;
      op: "eq" | "neq";
      value: FilterScalar;
    };

export type CephAdminAccountFilterRule =
  | TextRule<CephAdminAccountTextFilterField>
  | NumericRule<CephAdminAccountNumericFilterField>;

export type CephAdminUserFilterRule =
  | TextRule<CephAdminUserTextFilterField>
  | NumericRule<CephAdminUserNumericFilterField>
  | BooleanRule<CephAdminUserBooleanFilterField>;
