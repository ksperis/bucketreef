/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import type { GeneralSettings } from "./api/appSettings";
import { getWorkspaceAccess } from "./api/executionContexts";
import { fetchCurrentUser } from "./api/users";
import { useGeneralSettings } from "./components/GeneralSettingsContext";
import { cx, uiCardClass } from "./components/ui/styles";
import { useS3AccountContext } from "./features/manager/S3AccountContext";
import FeatureDisabledPage from "./features/shared/FeatureDisabledPage";
import { useSession } from "./auth/SessionProvider";
import {
  getManagerToolAccess,
  hasPortalWorkspaceAccess,
  isAdminLikeRole,
  readStoredUser,
  resolvePostLoginPath,
  setSessionUserCache,
  type SessionUser,
} from "./utils/workspaces";
import { prefetchWorkspaceBranch } from "./utils/routePrefetch";
import UnauthorizedPage from "./features/auth/UnauthorizedPage";
import ErrorState from "./components/errors/ErrorState";

const USER_ROLE = "ui_user";

function unauthorizedRoute() {
  return <UnauthorizedPage />;
}

function renderWorkspaceFeature(loading: boolean, enabled: boolean, feature: string) {
  if (loading) return <RouteFallback />;
  if (!enabled) return <FeatureDisabledPage feature={feature} />;
  return <Outlet />;
}

function renderManagerToolFeature(
  loading: boolean,
  enabled: boolean,
  feature: string,
  canAccess: boolean,
  requiresS3AccountSelection = true,
) {
  if (loading) return <RouteFallback />;
  if (!enabled) return <FeatureDisabledPage feature={feature} />;
  if (!requiresS3AccountSelection || !canAccess) return unauthorizedRoute();
  return <Outlet />;
}

export function RouteFallback() {
  return (
    <div className="shell-page flex min-h-screen items-center justify-center px-4">
      <div className={cx("px-4 py-3 ui-body font-semibold", uiCardClass)}>
        Loading workspace...
      </div>
    </div>
  );
}

export function RequireAuth() {
  const { loading, authenticated, bootstrapError, refresh } = useSession();
  if (loading) return <RouteFallback />;
  if (bootstrapError) return <ErrorState error={bootstrapError} onRetry={refresh} presentation="full" />;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: string[] }) {
  const { loading, user } = useSession();
  if (loading) return <RouteFallback />;
  if (!user || !user.role) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return unauthorizedRoute();
  return <Outlet />;
}

export function RoleRedirect() {
  const { user } = useSession();
  const { generalSettings, runtimeSurfaces, loading, runtimeSurfacesLoading } = useGeneralSettings();
  const destination =
    loading || runtimeSurfacesLoading
      ? null
      : resolvePostLoginPath(user, generalSettings, runtimeSurfaces);
  useEffect(() => {
    if (!destination) return;
    prefetchWorkspaceBranch(destination);
  }, [destination]);
  if (!destination) {
    return <RouteFallback />;
  }
  return <Navigate to={destination} replace />;
}

export function RequireManagerFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  return renderWorkspaceFeature(loading, generalSettings.manager_enabled, "Manager");
}

export function RequireManagerAccess() {
  const { authenticated, user } = useSession();
  const sessionIdentity = user?.id ?? user?.email;
  const [resolvedAccess, setResolvedAccess] = useState<{
    identity: typeof sessionIdentity;
    available: boolean;
  } | null>(null);
  const [accessError, setAccessError] = useState<unknown>(null);
  const [refreshAttempt, setRefreshAttempt] = useState(0);

  useEffect(() => {
    if (!authenticated || sessionIdentity == null) return;
    let cancelled = false;
    setAccessError(null);
    getWorkspaceAccess()
      .then((access) => {
        if (!cancelled) {
          setResolvedAccess({ identity: sessionIdentity, available: access.manager.available });
        }
      })
      .catch((error) => {
        if (!cancelled) setAccessError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, refreshAttempt, sessionIdentity]);

  if (!authenticated || sessionIdentity == null) return unauthorizedRoute();
  if (accessError) {
    return <ErrorState error={accessError} onRetry={() => setRefreshAttempt((attempt) => attempt + 1)} />;
  }
  if (resolvedAccess?.identity !== sessionIdentity) return <RouteFallback />;
  if (!resolvedAccess.available) return unauthorizedRoute();
  return <Outlet />;
}

export function RequirePortalAccess() {
  const { generalSettings, loading } = useGeneralSettings();
  const { authenticated, user: authenticatedUser } = useSession();
  const sessionIdentity = authenticatedUser?.id ?? authenticatedUser?.email;
  const authenticatedPortalAccess = hasPortalWorkspaceAccess(authenticatedUser);
  const [refreshedUser, setRefreshedUser] = useState<{ identity: typeof sessionIdentity; user: SessionUser } | null>(null);
  const sessionUser = authenticatedPortalAccess ? authenticatedUser
    : refreshedUser?.identity === sessionIdentity ? refreshedUser?.user : authenticatedUser;
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [refreshingSession, setRefreshingSession] = useState(() => {
    const storedUser = authenticatedUser;
    return Boolean(
      typeof window !== "undefined" && authenticated &&
        storedUser &&
        !hasPortalWorkspaceAccess(storedUser)
    );
  });

  useEffect(() => {
    if (loading || !generalSettings.portal_enabled || authenticatedPortalAccess) return;
    if (typeof window === "undefined" || !authenticated) return;
    let cancelled = false;
    setRefreshingSession(true);
    setRefreshError(null);
    fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        const mergedUser = { ...(readStoredUser() ?? {}), ...currentUser } as SessionUser;
        setSessionUserCache(mergedUser);
        setRefreshedUser({ identity: sessionIdentity, user: mergedUser });
      })
      .catch((error) => {
        if (!cancelled) setRefreshError(error);
      })
      .finally(() => {
        if (!cancelled) setRefreshingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, authenticatedPortalAccess, generalSettings.portal_enabled, loading, refreshAttempt, sessionIdentity]);

  if (loading) {
    return <RouteFallback />;
  }
  if (!generalSettings.portal_enabled) {
    return <FeatureDisabledPage feature="Portal" />;
  }
  if (refreshError) return <ErrorState error={refreshError} onRetry={() => setRefreshAttempt((attempt) => attempt + 1)} />;
  if (hasPortalWorkspaceAccess(sessionUser ?? null)) {
    return <Outlet />;
  }
  if (refreshingSession) {
    return <RouteFallback />;
  }
  if (!hasPortalWorkspaceAccess(sessionUser ?? null)) {
    return unauthorizedRoute();
  }
  return <Outlet />;
}

export function RequireCephAdminFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { user } = useSession();
  const canAccessCephAdmin = user?.effective_access?.can_access_ceph_admin ?? user?.can_access_ceph_admin;
  if (!user || !isAdminLikeRole(user.role) || !canAccessCephAdmin) {
    return unauthorizedRoute();
  }
  return renderWorkspaceFeature(loading, generalSettings.ceph_admin_enabled, "Ceph Admin");
}

export function RequireStorageOpsFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { user } = useSession();
  const canUseStorageOpsRole = Boolean(user && (isAdminLikeRole(user.role) || user.role === USER_ROLE));
  const canAccessStorageOps = user?.effective_access?.can_access_storage_ops ?? user?.can_access_storage_ops;
  if (!user || !canUseStorageOpsRole || !canAccessStorageOps) {
    return unauthorizedRoute();
  }
  return renderWorkspaceFeature(loading, generalSettings.storage_ops_enabled, "Storage Ops");
}

type BrowserSurface = "root" | "manager" | "ceph_admin";

function isBrowserSurfaceEnabled(generalSettings: GeneralSettings, surface: BrowserSurface) {
  if (!generalSettings.browser_enabled) return false;
  if (surface === "root") return generalSettings.browser_root_enabled;
  if (surface === "manager") return generalSettings.browser_manager_enabled;
  return generalSettings.browser_ceph_admin_enabled;
}

export function RequireBrowserSurface({ surface }: { surface: BrowserSurface }) {
  const { generalSettings, loading } = useGeneralSettings();
  const { user } = useSession();
  if (loading) return <RouteFallback />;
  const portalBrowserRootEnabled =
    surface === "root" &&
    generalSettings.browser_enabled &&
    generalSettings.portal_enabled &&
    generalSettings.browser_portal_enabled &&
    hasPortalWorkspaceAccess(user);
  if (!isBrowserSurfaceEnabled(generalSettings, surface) && !portalBrowserRootEnabled) {
    return <FeatureDisabledPage feature="Browser" />;
  }
  return <Outlet />;
}

export function RequireManagerIamFeature() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection, hasS3AccountContext } = useS3AccountContext();
  if (!requiresS3AccountSelection || !hasS3AccountContext) {
    return <Outlet />;
  }
  const selected = accounts.find((account) => account.id === selectedS3AccountId) ?? null;
  const iamEnabled = selected?.storage_endpoint_capabilities?.iam !== false;
  if (!iamEnabled) {
    return <FeatureDisabledPage feature="IAM" />;
  }
  return <Outlet />;
}

function canAccessManagerMigration(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_migration_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  return Boolean(getManagerToolAccess(user)?.bucket_migration);
}

function canAccessManagerBucketCompare(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_compare_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.bucket_compare) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

function canAccessManagerBucketIntegrity(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_integrity_check_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.bucket_integrity_check) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

function canAccessManagerBucketPurge(generalSettings: GeneralSettings, user: SessionUser | null): boolean {
  if (!generalSettings.bucket_purge_enabled || !user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.bucket_purge) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

function canAccessManagerFeatureRules(user: SessionUser | null): boolean {
  if (!user?.role) return false;
  if (!(isAdminLikeRole(user.role) || user.role === USER_ROLE)) return false;
  if (!getManagerToolAccess(user)?.feature_rules) return false;
  return user.capabilities?.can_manage_buckets !== false;
}

export function RequireManagerMigrationFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { user } = useSession();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_migration_enabled,
    "Bucket Migration",
    canAccessManagerMigration(generalSettings, user),
  );
}

export function RequireManagerBucketCompareFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const { user } = useSession();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_compare_enabled,
    "Bucket Compare",
    canAccessManagerBucketCompare(generalSettings, user),
    requiresS3AccountSelection,
  );
}

export function RequireManagerBucketIntegrityFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const { user } = useSession();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_integrity_check_enabled,
    "Bucket Integrity",
    canAccessManagerBucketIntegrity(generalSettings, user),
    requiresS3AccountSelection,
  );
}

export function RequireManagerBucketPurgeFeature() {
  const { generalSettings, loading } = useGeneralSettings();
  const { requiresS3AccountSelection } = useS3AccountContext();
  const { user } = useSession();
  return renderManagerToolFeature(
    loading,
    generalSettings.bucket_purge_enabled,
    "Bucket Purge",
    canAccessManagerBucketPurge(generalSettings, user),
    requiresS3AccountSelection,
  );
}

export function RequireManagerFeatureRulesTool() {
  const { user } = useSession();
  if (canAccessManagerFeatureRules(user)) {
    return <Outlet />;
  }
  return unauthorizedRoute();
}
