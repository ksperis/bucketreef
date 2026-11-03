export type BucketOverviewFeatureState = "active" | "inactive" | "warning" | "unavailable" | "loading";

export type BucketOverviewFeatureId =
  | "versioning"
  | "object-lock"
  | "server-side-encryption"
  | "replication"
  | "public-access-block"
  | "bucket-policy"
  | "cors"
  | "static-website"
  | "lifecycle"
  | "access-logging"
  | "notifications";

export type BucketOverviewSummaryItem = {
  id: BucketOverviewFeatureId;
  label: string;
  value: string;
  state: BucketOverviewFeatureState;
};

type BucketOverviewActiveFeature = {
  label: string;
  detail?: string;
  state: "active" | "warning";
};

type LoadableFeatureState = {
  configured: boolean;
  loading: boolean;
  hasError: boolean;
};

type CountedFeatureState = LoadableFeatureState & {
  count: number;
};

export type BucketOverviewSummaryInput = {
  accessLogging: LoadableFeatureState;
  cors: LoadableFeatureState;
  encryption: LoadableFeatureState;
  lifecycle: CountedFeatureState;
  notifications: CountedFeatureState;
  notificationsEnabled: boolean;
  objectLock: LoadableFeatureState;
  policy: LoadableFeatureState;
  publicAccess: {
    blocked: boolean;
    partial: boolean;
    loading: boolean;
    hasError: boolean;
  };
  replication: CountedFeatureState & {
    enabled: boolean;
  };
  serverSideEncryptionEnabled: boolean;
  staticWebsite: LoadableFeatureState & {
    enabled: boolean;
  };
  versioning: {
    enabled: boolean;
    loading: boolean;
    hasError: boolean;
    status: string | null | undefined;
  };
};

type BucketOverviewSummary = {
  activeFeatures: BucketOverviewActiveFeature[];
  loadingFeatures: boolean;
  dataProtection: BucketOverviewSummaryItem[];
  accessExposure: BucketOverviewSummaryItem[];
  dataManagement: BucketOverviewSummaryItem[];
};

type Text = (message: string, values?: Record<string, string | number>) => string;

type ResolvedFeature = {
  value: string;
  state: BucketOverviewFeatureState;
};

function resolveLoadableFeature(
  feature: LoadableFeatureState,
  labels: { configured: string; empty: string },
  text: Text,
): ResolvedFeature {
  if (feature.hasError) return { value: text("Unavailable"), state: "unavailable" };
  if (feature.loading) return { value: text("Loading..."), state: "loading" };
  return feature.configured
    ? { value: text(labels.configured), state: "active" }
    : { value: text(labels.empty), state: "inactive" };
}

function resolveCountedFeature(feature: CountedFeatureState, text: Text): ResolvedFeature {
  if (feature.hasError) return { value: text("Unavailable"), state: "unavailable" };
  if (feature.loading) return { value: text("Loading..."), state: "loading" };
  if (!feature.configured || feature.count <= 0) {
    return { value: text("Not configured"), state: "inactive" };
  }
  return {
    value: `${feature.count} ${text(feature.count === 1 ? "rule" : "rules")}`,
    state: "active",
  };
}

function resolveNotifications(feature: CountedFeatureState, text: Text): ResolvedFeature {
  if (feature.hasError) return { value: text("Unavailable"), state: "unavailable" };
  if (feature.loading) return { value: text("Loading..."), state: "loading" };
  if (!feature.configured || feature.count <= 0) {
    return { value: text("Not configured"), state: "inactive" };
  }
  return {
    value: `${feature.count} ${text(feature.count === 1 ? "notification" : "notifications")}`,
    state: "active",
  };
}

function resolveVersioning(
  versioning: BucketOverviewSummaryInput["versioning"],
  text: Text,
): ResolvedFeature {
  if (versioning.hasError) return { value: text("Unavailable"), state: "unavailable" };
  if (versioning.loading) return { value: text("Loading..."), state: "loading" };
  return {
    value: text(versioning.status ?? (versioning.enabled ? "Enabled" : "Disabled")),
    state: versioning.enabled ? "active" : "inactive",
  };
}

function resolvePublicAccess(
  publicAccess: BucketOverviewSummaryInput["publicAccess"],
  text: Text,
): ResolvedFeature {
  if (publicAccess.hasError) return { value: text("Unavailable"), state: "unavailable" };
  if (publicAccess.loading) return { value: text("Loading..."), state: "loading" };
  if (publicAccess.blocked) return { value: text("Blocked"), state: "active" };
  if (publicAccess.partial) return { value: text("Partially blocked"), state: "warning" };
  return { value: text("Not blocked"), state: "warning" };
}

function summaryItem(
  id: BucketOverviewFeatureId,
  label: string,
  resolved: ResolvedFeature,
): BucketOverviewSummaryItem {
  return { id, label, value: resolved.value, state: resolved.state };
}

function activeFeature(
  feature: ResolvedFeature,
  label: string,
  detail?: string,
): BucketOverviewActiveFeature | null {
  if (feature.state !== "active" && feature.state !== "warning") return null;
  return detail === undefined
    ? { label, state: feature.state }
    : { label, detail, state: feature.state };
}

export function buildBucketOverviewSummary(
  input: BucketOverviewSummaryInput,
  text: Text,
): BucketOverviewSummary {
  const versioning = resolveVersioning(input.versioning, text);
  const objectLock = resolveLoadableFeature(input.objectLock, { configured: "Enabled", empty: "Disabled" }, text);
  const encryption = resolveLoadableFeature(input.encryption, { configured: "Configured", empty: "Not configured" }, text);
  const replication = resolveCountedFeature(input.replication, text);
  const publicAccess = resolvePublicAccess(input.publicAccess, text);
  const policy = resolveLoadableFeature(input.policy, { configured: "Configured", empty: "Not configured" }, text);
  const cors = resolveLoadableFeature(input.cors, { configured: "Configured", empty: "Not configured" }, text);
  const staticWebsite = resolveLoadableFeature(input.staticWebsite, { configured: "Enabled", empty: "Disabled" }, text);
  const lifecycle = resolveCountedFeature(input.lifecycle, text);
  const accessLogging = resolveLoadableFeature(input.accessLogging, { configured: "Enabled", empty: "Disabled" }, text);
  const notifications = resolveNotifications(input.notifications, text);

  const dataProtection: BucketOverviewSummaryItem[] = [
    summaryItem("versioning", text("Versioning"), versioning),
    summaryItem("object-lock", text("Object Lock"), objectLock),
  ];

  if (input.serverSideEncryptionEnabled) {
    dataProtection.push(summaryItem("server-side-encryption", text("Server-side encryption"), encryption));
  }

  if (input.replication.enabled) {
    dataProtection.push(summaryItem("replication", text("Replication"), replication));
  }

  const accessExposure: BucketOverviewSummaryItem[] = [
    summaryItem("public-access-block", text("Block public access"), publicAccess),
    summaryItem("bucket-policy", text("Bucket policy"), policy),
    summaryItem("cors", text("CORS"), cors),
  ];

  if (input.staticWebsite.enabled) {
    accessExposure.push(summaryItem("static-website", text("Static website"), staticWebsite));
  }

  const dataManagement: BucketOverviewSummaryItem[] = [
    summaryItem("lifecycle", text("Lifecycle"), lifecycle),
    summaryItem("access-logging", text("Access logging"), accessLogging),
  ];

  if (input.notificationsEnabled) {
    dataManagement.push(summaryItem("notifications", text("Notifications"), notifications));
  }

  const activeFeatures = [
    activeFeature(versioning, text("Versioning")),
    activeFeature(objectLock, text("Object Lock")),
    input.serverSideEncryptionEnabled ? activeFeature(encryption, text("Encryption")) : null,
    input.replication.enabled ? activeFeature(replication, text("Replication"), replication.value) : null,
    publicAccess.state === "active"
      ? activeFeature(publicAccess, text("Public access blocked"))
      : publicAccess.state === "warning"
        ? activeFeature(
            publicAccess,
            text(input.publicAccess.partial ? "Public access partially blocked" : "Public access not blocked"),
          )
        : null,
    activeFeature(policy, text("Bucket policy")),
    activeFeature(cors, text("CORS")),
    input.staticWebsite.enabled ? activeFeature(staticWebsite, text("Static website")) : null,
    activeFeature(lifecycle, text("Lifecycle"), lifecycle.value),
    activeFeature(accessLogging, text("Access logging")),
    input.notificationsEnabled ? activeFeature(notifications, text("Notifications"), notifications.value) : null,
  ].filter((feature): feature is BucketOverviewActiveFeature => feature !== null);

  const loadingFeatures = [
    versioning,
    objectLock,
    ...(input.serverSideEncryptionEnabled ? [encryption] : []),
    ...(input.replication.enabled ? [replication] : []),
    publicAccess,
    policy,
    cors,
    ...(input.staticWebsite.enabled ? [staticWebsite] : []),
    lifecycle,
    accessLogging,
    ...(input.notificationsEnabled ? [notifications] : []),
  ].some((feature) => feature.state === "loading");

  return { activeFeatures, loadingFeatures, dataProtection, accessExposure, dataManagement };
}
