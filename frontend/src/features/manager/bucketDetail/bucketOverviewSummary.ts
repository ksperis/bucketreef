type BucketOverviewSummaryItem = {
  label: string;
  value: string;
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

export type BucketOverviewSummary = {
  dataProtection: BucketOverviewSummaryItem[];
  accessExposure: BucketOverviewSummaryItem[];
  dataManagement: BucketOverviewSummaryItem[];
};

type Text = (message: string, values?: Record<string, string | number>) => string;

function resolveLoadableFeature(
  feature: LoadableFeatureState,
  labels: { configured: string; empty: string },
  text: Text,
): string {
  if (feature.hasError) return text("Unavailable");
  if (feature.loading) return text("Loading...");
  return text(feature.configured ? labels.configured : labels.empty);
}

function resolveCountedFeature(feature: CountedFeatureState, text: Text): string {
  if (feature.hasError) return text("Unavailable");
  if (feature.loading) return text("Loading...");
  if (!feature.configured || feature.count <= 0) return text("Not configured");
  return `${feature.count} ${text(feature.count === 1 ? "rule" : "rules")}`;
}

function resolveNotifications(feature: CountedFeatureState, text: Text): string {
  if (feature.hasError) return text("Unavailable");
  if (feature.loading) return text("Loading...");
  if (!feature.configured || feature.count <= 0) return text("Not configured");
  return `${feature.count} ${text(feature.count === 1 ? "notification" : "notifications")}`;
}

function resolveVersioning(
  versioning: BucketOverviewSummaryInput["versioning"],
  text: Text,
): string {
  if (versioning.hasError) return text("Unavailable");
  if (versioning.loading) return text("Loading...");
  return text(versioning.status ?? (versioning.enabled ? "Enabled" : "Disabled"));
}

function resolvePublicAccess(
  publicAccess: BucketOverviewSummaryInput["publicAccess"],
  text: Text,
): string {
  if (publicAccess.hasError) return text("Unavailable");
  if (publicAccess.loading) return text("Loading...");
  if (publicAccess.blocked) return text("Blocked");
  if (publicAccess.partial) return text("Partially blocked");
  return text("Not blocked");
}

export function buildBucketOverviewSummary(
  input: BucketOverviewSummaryInput,
  text: Text,
): BucketOverviewSummary {
  const dataProtection: BucketOverviewSummaryItem[] = [
    { label: text("Versioning"), value: resolveVersioning(input.versioning, text) },
    {
      label: text("Object Lock"),
      value: resolveLoadableFeature(input.objectLock, { configured: "Enabled", empty: "Disabled" }, text),
    },
  ];

  if (input.serverSideEncryptionEnabled) {
    dataProtection.push({
      label: text("Server-side encryption"),
      value: resolveLoadableFeature(input.encryption, { configured: "Configured", empty: "Not configured" }, text),
    });
  }

  if (input.replication.enabled) {
    dataProtection.push({
      label: text("Replication"),
      value: resolveCountedFeature(input.replication, text),
    });
  }

  const accessExposure: BucketOverviewSummaryItem[] = [
    { label: text("Block public access"), value: resolvePublicAccess(input.publicAccess, text) },
    {
      label: text("Bucket policy"),
      value: resolveLoadableFeature(input.policy, { configured: "Configured", empty: "Not configured" }, text),
    },
    {
      label: text("CORS"),
      value: resolveLoadableFeature(input.cors, { configured: "Configured", empty: "Not configured" }, text),
    },
  ];

  if (input.staticWebsite.enabled) {
    accessExposure.push({
      label: text("Static website"),
      value: resolveLoadableFeature(input.staticWebsite, { configured: "Enabled", empty: "Disabled" }, text),
    });
  }

  const dataManagement: BucketOverviewSummaryItem[] = [
    { label: text("Lifecycle"), value: resolveCountedFeature(input.lifecycle, text) },
    {
      label: text("Access logging"),
      value: resolveLoadableFeature(input.accessLogging, { configured: "Enabled", empty: "Disabled" }, text),
    },
  ];

  if (input.notificationsEnabled) {
    dataManagement.push({
      label: text("Notifications"),
      value: resolveNotifications(input.notifications, text),
    });
  }

  return { dataProtection, accessExposure, dataManagement };
}
