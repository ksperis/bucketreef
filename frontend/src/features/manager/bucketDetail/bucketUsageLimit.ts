import { clampPercentage } from "../../../utils/numbers";

export type BucketUsageLimitSource = "bucket" | "account" | "user" | "owner" | null;

type ResolveBucketUsageLimitOptions = {
  used?: number | null;
  bucketQuota?: number | null;
  ownerUsed?: number | null;
  ownerQuota?: number | null;
  ownerSource?: Exclude<BucketUsageLimitSource, "bucket" | null> | null;
};

export type BucketUsageLimit = {
  limit: number | null;
  bucketQuota: number | null;
  ownerQuota: number | null;
  ratio: number | null;
  source: BucketUsageLimitSource;
  ownerConstraintUnavailable: boolean;
};

function finiteNonNegative(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function positiveLimit(value?: number | null): number | null {
  const normalized = finiteNonNegative(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

export function resolveBucketUsageLimit({
  used,
  bucketQuota,
  ownerUsed,
  ownerQuota,
  ownerSource = null,
}: ResolveBucketUsageLimitOptions): BucketUsageLimit {
  const normalizedUsed = finiteNonNegative(used);
  const bucketLimit = positiveLimit(bucketQuota);
  const normalizedOwnerQuota = positiveLimit(ownerQuota);
  const normalizedOwnerUsed = finiteNonNegative(ownerUsed);
  const ownerConstraintUnavailable = Boolean(
    normalizedOwnerQuota !== null &&
    normalizedOwnerUsed === null,
  );

  let ownerLimit: number | null = null;
  if (
    normalizedUsed !== null &&
    normalizedOwnerQuota !== null &&
    normalizedOwnerUsed !== null
  ) {
    const aggregateUsed = Math.max(normalizedOwnerUsed, normalizedUsed);
    ownerLimit = normalizedUsed + Math.max(normalizedOwnerQuota - aggregateUsed, 0);
  }

  let limit: number | null = null;
  let source: BucketUsageLimitSource = null;

  if (bucketLimit !== null && ownerLimit !== null) {
    if (ownerLimit < bucketLimit) {
      limit = ownerLimit;
      source = ownerSource;
    } else {
      limit = bucketLimit;
      source = "bucket";
    }
  } else if (bucketLimit !== null) {
    limit = bucketLimit;
    source = "bucket";
  } else if (ownerLimit !== null) {
    limit = ownerLimit;
    source = ownerSource;
  }

  const ratio = normalizedUsed === null || limit === null
    ? null
    : limit <= 0
      ? 100
      : clampPercentage((normalizedUsed / limit) * 100);
  return {
    limit,
    bucketQuota: bucketLimit,
    ownerQuota: normalizedOwnerQuota,
    ratio,
    source,
    ownerConstraintUnavailable,
  };
}
