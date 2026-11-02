import type { PropertySummaryTone } from "../../../components/PropertySummaryChip";

type BucketPropertySummary = {
  label: string;
  state: string;
  tone: PropertySummaryTone;
};

type LoadableFeatureState = {
  configured: boolean;
  loading: boolean;
  hasError: boolean;
};

export type BucketPropertySummaryInput = {
  accessLogging: LoadableFeatureState;
  bucketAvailable: boolean;
  cors: LoadableFeatureState;
  encryption: LoadableFeatureState;
  lifecycle: LoadableFeatureState;
  notifications: LoadableFeatureState;
  objectLock: LoadableFeatureState;
  policy: LoadableFeatureState;
  publicAccess: {
    blocked: boolean;
    partial: boolean;
    loading: boolean;
    hasError: boolean;
  };
  quota: {
    configured: boolean;
    enabled: boolean;
  };
  replication: LoadableFeatureState & {
    enabled: boolean;
    endpointSupported: boolean;
  };
  serverSideEncryptionEnabled: boolean;
  staticWebsite: LoadableFeatureState & {
    enabled: boolean;
  };
  notificationsEnabled: boolean;
  versioning: {
    enabled: boolean;
    loading: boolean;
    hasError: boolean;
    status: string | null | undefined;
  };
};

type ResolvedFeatureState = {
  state: string;
  tone: PropertySummaryTone;
};

function resolveLoadableFeature(
  feature: LoadableFeatureState,
  labels: { configured: string; empty: string },
  available = true,
): ResolvedFeatureState {
  if (!available || feature.hasError) {
    return { state: "Unavailable", tone: "unknown" };
  }
  if (feature.loading) {
    return { state: "Loading...", tone: "unknown" };
  }
  return feature.configured
    ? { state: labels.configured, tone: "active" }
    : { state: labels.empty, tone: "inactive" };
}

function resolveVersioning(
  versioning: BucketPropertySummaryInput["versioning"],
): ResolvedFeatureState {
  if (versioning.loading) {
    return { state: "Loading...", tone: "unknown" };
  }
  if (versioning.hasError) {
    return { state: "Unavailable", tone: "unknown" };
  }
  const state = versioning.status ?? "Disabled";
  if (versioning.enabled) {
    return { state, tone: "active" };
  }
  return {
    state,
    tone: state.trim().toLowerCase() === "suspended" ? "unknown" : "inactive",
  };
}

function resolvePublicAccess(
  publicAccess: BucketPropertySummaryInput["publicAccess"],
): ResolvedFeatureState {
  if (publicAccess.loading) {
    return { state: "Loading...", tone: "unknown" };
  }
  if (publicAccess.hasError) {
    return { state: "Unavailable", tone: "unknown" };
  }
  if (publicAccess.blocked) {
    return { state: "Enabled", tone: "active" };
  }
  if (publicAccess.partial) {
    return { state: "Partial", tone: "active" };
  }
  return { state: "Disabled", tone: "inactive" };
}

export function buildBucketPropertySummary(
  input: BucketPropertySummaryInput,
  text: (message: string) => string,
): BucketPropertySummary[] {
  const versioning = resolveVersioning(input.versioning);
  const objectLock = resolveLoadableFeature(
    input.objectLock,
    { configured: "Enabled", empty: "Disabled" },
  );
  const publicAccess = resolvePublicAccess(input.publicAccess);
  const lifecycle = resolveLoadableFeature(
    input.lifecycle,
    { configured: "Enabled", empty: "Disabled" },
  );
  const policy = resolveLoadableFeature(
    input.policy,
    { configured: "Configured", empty: "Not set" },
  );
  const cors = resolveLoadableFeature(
    input.cors,
    { configured: "Configured", empty: "Not set" },
  );
  const accessLogging = resolveLoadableFeature(
    input.accessLogging,
    { configured: "Enabled", empty: "Disabled" },
  );

  const summary: BucketPropertySummary[] = [
    { label: text("Versioning"), state: text(versioning.state), tone: versioning.tone },
    { label: text("Object Lock"), state: text(objectLock.state), tone: objectLock.tone },
    { label: text("Block public access"), state: text(publicAccess.state), tone: publicAccess.tone },
    { label: text("Lifecycle rules"), state: text(lifecycle.state), tone: lifecycle.tone },
  ];

  if (input.staticWebsite.enabled) {
    const website = resolveLoadableFeature(
      input.staticWebsite,
      { configured: "Enabled", empty: "Disabled" },
    );
    summary.push({ label: text("Static website"), state: text(website.state), tone: website.tone });
  }

  if (input.quota.enabled) {
    const quota: ResolvedFeatureState = !input.bucketAvailable
      ? { state: "Unknown", tone: "unknown" }
      : input.quota.configured
        ? { state: "Configured", tone: "active" }
        : { state: "Not set", tone: "inactive" };
    summary.push({ label: text("Quota"), state: text(quota.state), tone: quota.tone });
  }

  summary.push({ label: text("Bucket policy"), state: text(policy.state), tone: policy.tone });
  summary.push({ label: text("CORS"), state: text(cors.state), tone: cors.tone });

  if (input.serverSideEncryptionEnabled) {
    const encryption = resolveLoadableFeature(
      input.encryption,
      { configured: "Enabled", empty: "Disabled" },
    );
    summary.push({
      label: text("Server-side encryption"),
      state: text(encryption.state),
      tone: encryption.tone,
    });
  }

  summary.push({
    label: text("Access logging"),
    state: text(accessLogging.state),
    tone: accessLogging.tone,
  });

  if (input.notificationsEnabled) {
    const notifications = resolveLoadableFeature(
      input.notifications,
      { configured: "Configured", empty: "Not set" },
    );
    summary.push({
      label: text("Notifications"),
      state: text(notifications.state),
      tone: notifications.tone,
    });
  }

  if (input.replication.enabled) {
    const replication = resolveLoadableFeature(
      input.replication,
      { configured: "Configured", empty: "Not set" },
      input.replication.endpointSupported,
    );
    summary.push({
      label: text("Replication"),
      state: text(replication.state),
      tone: replication.tone,
    });
  }

  return summary;
}
