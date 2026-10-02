/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { UiLanguage } from "../components/language";
import type { WorkspaceId } from "../utils/workspaces";

const DOCUMENTATION_BASE_URL = "https://docs.bucketreef.ksperis.com";

type DocumentationGuide = "admin" | "manager" | "portal" | "browser";
type DocumentationLanguage = "en" | "fr";

type DocumentationTopic =
  | "browser-operations"
  | "browser-versions"
  | "troubleshooting";

type DocumentationTarget = {
  guide: DocumentationGuide;
  page?: string;
};

const GUIDE_LANGUAGES: Record<DocumentationGuide, readonly DocumentationLanguage[]> = {
  admin: ["en"],
  manager: ["en"],
  portal: ["en", "fr"],
  browser: ["en"],
};

const WORKSPACE_GUIDES: Partial<Record<WorkspaceId, DocumentationGuide>> = {
  admin: "admin",
  "ceph-admin": "admin",
  "storage-ops": "admin",
  manager: "manager",
  portal: "portal",
  browser: "browser",
};

const ROUTE_TARGETS: Array<{ prefix: string; target: DocumentationTarget }> = [
  { prefix: "/admin/production-readiness", target: { guide: "admin", page: "operations/production-checks" } },
  { prefix: "/admin/onboarding", target: { guide: "admin", page: "getting-started" } },
  { prefix: "/admin/endpoint-status", target: { guide: "admin", page: "platform/endpoint-status" } },
  { prefix: "/admin/metrics", target: { guide: "admin", page: "platform/usage-metrics" } },
  { prefix: "/admin/usage-history", target: { guide: "admin", page: "platform/usage-history" } },
  { prefix: "/admin/access-audit", target: { guide: "admin", page: "platform/access-audit" } },
  { prefix: "/admin/audit", target: { guide: "admin", page: "platform/audit" } },
  { prefix: "/admin/billing", target: { guide: "admin", page: "platform/billing" } },
  { prefix: "/admin/portal-requests", target: { guide: "admin", page: "platform/portal-delegation" } },
  { prefix: "/admin/authentication-settings", target: { guide: "admin", page: "security/authentication" } },
  { prefix: "/admin/key-rotation", target: { guide: "admin", page: "platform/key-rotation" } },
  { prefix: "/admin/webhook-settings", target: { guide: "admin", page: "operations/webhooks" } },
  { prefix: "/admin/general-settings", target: { guide: "admin", page: "configuration" } },
  { prefix: "/admin/manager-settings", target: { guide: "admin", page: "configuration" } },
  { prefix: "/admin/browser-settings", target: { guide: "admin", page: "configuration" } },
  { prefix: "/admin/portal-settings", target: { guide: "admin", page: "configuration" } },
  { prefix: "/admin/profile", target: { guide: "admin", page: "profile" } },
  { prefix: "/admin", target: { guide: "admin" } },

  { prefix: "/ceph-admin/browser", target: { guide: "admin", page: "storage/browser-operations" } },
  { prefix: "/ceph-admin/profile", target: { guide: "admin", page: "profile" } },
  { prefix: "/ceph-admin/metrics", target: { guide: "admin", page: "platform/usage-metrics" } },
  { prefix: "/ceph-admin", target: { guide: "admin", page: "storage/ceph-admin" } },

  { prefix: "/storage-ops", target: { guide: "admin", page: "storage/storage-ops" } },

  { prefix: "/manager/browser", target: { guide: "manager", page: "browser/object-operations" } },
  { prefix: "/manager/buckets", target: { guide: "manager", page: "buckets" } },
  { prefix: "/manager/metrics", target: { guide: "manager", page: "buckets/usage" } },
  { prefix: "/manager/users", target: { guide: "manager", page: "iam" } },
  { prefix: "/manager/groups", target: { guide: "manager", page: "iam" } },
  { prefix: "/manager/roles", target: { guide: "manager", page: "iam" } },
  { prefix: "/manager/iam", target: { guide: "manager", page: "iam" } },
  { prefix: "/manager/ceph/keys", target: { guide: "manager", page: "iam/access-keys" } },
  { prefix: "/manager/topics", target: { guide: "manager", page: "topics" } },
  { prefix: "/manager/bucket-compare", target: { guide: "manager", page: "tools/bucket-compare" } },
  { prefix: "/manager/bucket-integrity", target: { guide: "manager", page: "tools/bucket-integrity" } },
  { prefix: "/manager/bucket-purge", target: { guide: "manager", page: "tools/bucket-purge" } },
  { prefix: "/manager/migrations", target: { guide: "manager", page: "tools/bucket-migration" } },
  { prefix: "/manager/profile", target: { guide: "manager", page: "profile" } },
  { prefix: "/manager", target: { guide: "manager" } },

  { prefix: "/portal/storage-spaces/", target: { guide: "portal", page: "files" } },
  { prefix: "/portal/storage-spaces", target: { guide: "portal", page: "spaces" } },
  { prefix: "/portal/access-keys", target: { guide: "portal", page: "external-tools" } },
  { prefix: "/portal/shares", target: { guide: "portal", page: "collaboration" } },
  { prefix: "/portal/requests", target: { guide: "portal", page: "help-requests" } },
  { prefix: "/portal/history", target: { guide: "portal", page: "activity" } },
  { prefix: "/portal/usage", target: { guide: "portal", page: "storage-health" } },
  { prefix: "/portal/settings", target: { guide: "portal", page: "settings" } },
  { prefix: "/portal/profile", target: { guide: "portal", page: "profile" } },
  { prefix: "/portal", target: { guide: "portal" } },

  { prefix: "/browser/profile", target: { guide: "browser", page: "profile" } },
  { prefix: "/browser", target: { guide: "browser" } },
];

const BROWSER_TOPIC_TARGETS: Partial<Record<WorkspaceId, Record<"browser-operations" | "browser-versions", DocumentationTarget>>> = {
  browser: {
    "browser-operations": { guide: "browser", page: "objects/operations" },
    "browser-versions": { guide: "browser", page: "objects/versions" },
  },
  manager: {
    "browser-operations": { guide: "manager", page: "browser/object-operations" },
    "browser-versions": { guide: "manager", page: "browser/versions" },
  },
  portal: {
    "browser-operations": { guide: "portal", page: "files" },
    "browser-versions": { guide: "portal", page: "files/versions" },
  },
  "ceph-admin": {
    "browser-operations": { guide: "admin", page: "storage/browser-operations" },
    "browser-versions": { guide: "admin", page: "storage/browser-versions" },
  },
};

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

function routeMatches(pathname: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function workspaceFromPath(pathname: string): WorkspaceId | null {
  const segment = normalizePathname(pathname).split("/")[1] as WorkspaceId | undefined;
  return segment && Object.prototype.hasOwnProperty.call(WORKSPACE_GUIDES, segment) ? segment : null;
}

function resolveLanguage(guide: DocumentationGuide, requested?: UiLanguage): DocumentationLanguage {
  const languages = GUIDE_LANGUAGES[guide];
  return requested && languages.includes(requested as DocumentationLanguage)
    ? (requested as DocumentationLanguage)
    : languages[0];
}

function buildDocumentationUrl(target: DocumentationTarget, language?: UiLanguage): string {
  const resolvedLanguage = resolveLanguage(target.guide, language);
  const page = target.page ? `/${target.page.replace(/^\/+|\/+$/g, "")}` : "";
  return `${DOCUMENTATION_BASE_URL}/${target.guide}/${resolvedLanguage}${page}/`;
}

export function resolveDocumentationUrl(
  pathname: string,
  options: { language?: UiLanguage; topic?: DocumentationTopic } = {},
): string | null {
  const normalizedPathname = normalizePathname(pathname);
  const workspace = workspaceFromPath(normalizedPathname);
  if (!workspace) return null;

  if (options.topic === "troubleshooting") {
    const guide = WORKSPACE_GUIDES[workspace];
    return guide ? buildDocumentationUrl({ guide, page: "help/troubleshooting" }, options.language) : null;
  }

  if (options.topic === "browser-operations" || options.topic === "browser-versions") {
    const target = BROWSER_TOPIC_TARGETS[workspace]?.[options.topic];
    if (target) return buildDocumentationUrl(target, options.language);
  }

  const routeTarget = ROUTE_TARGETS.find(({ prefix }) => routeMatches(normalizedPathname, prefix))?.target;
  return routeTarget ? buildDocumentationUrl(routeTarget, options.language) : null;
}
