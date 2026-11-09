import type { SVGProps } from "react";

import { OpenStackIcon as NavOpenStackIcon } from "./topbarIcons";

type SidebarIconLink = {
  label: string;
  to: string;
  iconName?: SidebarLinkIconName;
};

export type SidebarLinkIconName =
  | "home"
  | "chart"
  | "history"
  | "bucket"
  | "folder"
  | "connection"
  | "status"
  | "endpoint"
  | "portal"
  | "key"
  | "audit"
  | "access-audit"
  | "user"
  | "group"
  | "shield"
  | "document"
  | "cog"
  | "bell"
  | "webhook"
  | "cost"
  | "tools"
  | "rules"
  | "compare"
  | "integrity"
  | "purge"
  | "migration"
  | "multisite"
  | "openstack"
  | "stack"
  | "dot";

export function resolveSidebarLinkIconName(link: SidebarIconLink): SidebarLinkIconName {
  if (link.iconName) return link.iconName;
  const key = `${link.label} ${link.to}`.toLowerCase();
  if (key.includes("dashboard") || key.includes("home")) return "home";
  if (key.includes("metric")) return "chart";
  if (key.includes("history")) return "history";
  if (key.includes("multisite")) return "multisite";
  if (key.includes("bucket")) return "bucket";
  if (key.includes("browser")) return "folder";
  if (key.includes("connection")) return "connection";
  if (key.includes("status") || key.includes("health")) return "status";
  if (key.includes("endpoint")) return "endpoint";
  if (key.includes("portal")) return "portal";
  if (key.includes("key") || key.includes("rotation")) return "key";
  if (key.includes("access audit") || key.includes("access-audit")) return "access-audit";
  if (key.includes("audit")) return "audit";
  if (key.includes("user")) return "user";
  if (key.includes("group")) return "group";
  if (key.includes("role")) return "shield";
  if (key.includes("polic")) return "document";
  if (key.includes("topic") || key.includes("event")) return "bell";
  if (key.includes("webhook")) return "webhook";
  if (key.includes("cost")) return "cost";
  if (key.includes("setting") || key.includes("general")) return "cog";
  if (key.includes("feature") || key.includes("rule")) return "rules";
  if (key.includes("compare")) return "compare";
  if (key.includes("integrity")) return "integrity";
  if (key.includes("purge")) return "purge";
  if (key.includes("migration")) return "migration";
  if (key.includes("manage")) return "tools";
  if (key.includes("account")) return "stack";
  return "dot";
}

export function resolveSidebarLinkIcon(link: SidebarIconLink) {
  const iconName = resolveSidebarLinkIconName(link);
  if (iconName === "home") return <NavHomeIcon />;
  if (iconName === "chart") return <NavChartIcon />;
  if (iconName === "history") return <NavHistoryIcon />;
  if (iconName === "bucket") return <NavBucketIcon />;
  if (iconName === "folder") return <NavFolderIcon />;
  if (iconName === "connection") return <NavConnectionIcon />;
  if (iconName === "status") return <NavStatusIcon />;
  if (iconName === "endpoint") return <NavEndpointIcon />;
  if (iconName === "portal") return <NavPortalIcon />;
  if (iconName === "key") return <NavKeyIcon />;
  if (iconName === "audit") return <NavAuditIcon />;
  if (iconName === "access-audit") return <NavAccessAuditIcon />;
  if (iconName === "user") return <NavUserIcon />;
  if (iconName === "group") return <NavGroupIcon />;
  if (iconName === "shield") return <NavShieldIcon />;
  if (iconName === "document") return <NavDocumentIcon />;
  if (iconName === "cog") return <NavCogIcon />;
  if (iconName === "bell") return <NavBellIcon />;
  if (iconName === "webhook") return <NavWebhookIcon />;
  if (iconName === "cost") return <NavCostIcon />;
  if (iconName === "tools") return <NavToolsIcon />;
  if (iconName === "rules") return <NavRulesIcon />;
  if (iconName === "compare") return <NavCompareIcon />;
  if (iconName === "integrity") return <NavIntegrityIcon />;
  if (iconName === "purge") return <NavPurgeIcon />;
  if (iconName === "migration") return <NavMigrationIcon />;
  if (iconName === "multisite") return <NavMultisiteIcon />;
  if (iconName === "openstack") return <NavOpenStackIcon />;
  if (iconName === "stack") return <NavStackIcon />;
  return <NavDotIcon />;
}

function NavHomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 9.5 10 4l7 5.5V17H3V9.5Z" />
    </svg>
  );
}

function NavChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 16V9m6 7V4m6 12v-6" />
    </svg>
  );
}

function NavHistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5.2 6.5A5.5 5.5 0 1 1 4.5 13" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5.2 6.5H2.8V4.1M10 7.2v3.4l2.2 1.4" />
    </svg>
  );
}

function NavBucketIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h12l-1 9H5L4 6Zm2-2h8" />
    </svg>
  );
}

function NavFolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M2.5 6.5h5l1.5 1.8H17v7.2H2.5V6.5Z" />
    </svg>
  );
}

function NavConnectionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M7.5 6.5h-1A3.5 3.5 0 0 0 3 10a3.5 3.5 0 0 0 3.5 3.5h1m5-7h1A3.5 3.5 0 0 1 17 10a3.5 3.5 0 0 1-3.5 3.5h-1M7.2 10h5.6" />
    </svg>
  );
}

function NavStatusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h3l1.5-4 3 8 1.8-4H17" />
    </svg>
  );
}

function NavEndpointIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <rect x="4" y="4" width="12" height="4.5" rx="1.4" strokeWidth={1.7} />
      <rect x="4" y="11.5" width="12" height="4.5" rx="1.4" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeWidth={1.7} d="M7 6.3h.1M7 13.8h.1M10 8.5v3" />
    </svg>
  );
}

function NavMultisiteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 7v3M5 13v-3h10v3" />
      <rect x="7.5" y="2.5" width="5" height="4.5" rx="1" strokeWidth={1.7} />
      <rect x="2.5" y="13" width="5" height="4.5" rx="1" strokeWidth={1.7} />
      <rect x="12.5" y="13" width="5" height="4.5" rx="1" strokeWidth={1.7} />
    </svg>
  );
}

function NavPortalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 5.5h12v9H4v-9Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8.2 14.5 7.5 17h5l-.7-2.5M7.5 9.8h5" />
    </svg>
  );
}

function NavKeyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="7" cy="10" r="3" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 10h6m-2 0v2m-2-2v1.5" />
    </svg>
  );
}

function NavAuditIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 3.5h6l3 3V16.5H6V3.5Zm6 0v3h3" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M8.5 10h3.8M8.5 13h3" />
    </svg>
  );
}

function NavAccessAuditIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
        d="M8.5 3.5 13 5.4v3.8c0 2.3-1.5 4-4.5 5.2C5.5 13.2 4 11.5 4 9.2V5.4l4.5-1.9Z"
      />
      <circle cx="13.7" cy="13.2" r="2.4" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeWidth={1.7} d="m15.5 15 1.6 1.6" />
    </svg>
  );
}

function NavUserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="10" cy="6.5" r="2.6" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4.5 15.5c1.4-2 3-3 5.5-3s4.1 1 5.5 3" />
    </svg>
  );
}

function NavGroupIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="7" cy="7.2" r="2.2" strokeWidth={1.6} />
      <circle cx="13.1" cy="8.1" r="1.8" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3.8 15.2c.9-1.6 2-2.4 3.8-2.4 1.7 0 2.8.8 3.7 2.4m1.3-2.2c1.3.1 2.2.8 3 2" />
    </svg>
  );
}

function NavShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 3.5 15.5 5.8v4.8c0 2.8-1.8 4.8-5.5 6.2-3.7-1.4-5.5-3.4-5.5-6.2V5.8L10 3.5Z" />
    </svg>
  );
}

function NavDocumentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 3.5h6l3 3V16.5H6V3.5Zm6 0v3h3" />
    </svg>
  );
}

function NavCogIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 5.5h12" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 10h12" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M4 14.5h12" />
      <circle cx="7.2" cy="5.5" r="1.5" strokeWidth={1.7} />
      <circle cx="12.4" cy="10" r="1.5" strokeWidth={1.7} />
      <circle cx="9.5" cy="14.5" r="1.5" strokeWidth={1.7} />
    </svg>
  );
}

function NavBellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 4.2a3.2 3.2 0 0 0-3.2 3.2v2.2c0 .9-.3 1.7-1 2.3l-.8.7h10l-.8-.7c-.7-.6-1-1.4-1-2.3V7.4A3.2 3.2 0 0 0 10 4.2Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8.6 14.5a1.5 1.5 0 0 0 2.8 0" />
    </svg>
  );
}

function NavWebhookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="4.5" cy="10" r="1.8" strokeWidth={1.7} />
      <circle cx="15.5" cy="5.5" r="1.8" strokeWidth={1.7} />
      <circle cx="15.5" cy="14.5" r="1.8" strokeWidth={1.7} />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
        d="M6.3 10h2.2c2.2 0 2.2-4.5 5.2-4.5M8.5 10c2.2 0 2.2 4.5 5.2 4.5"
      />
    </svg>
  );
}

function NavCostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <rect x="4" y="3.5" width="12" height="13" rx="1.8" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeWidth={1.7} d="M6.7 6.8h6.6M7 10.3h.1M10 10.3h.1M13 10.3h.1M7 13.3h.1M10 13.3h.1M13 13.3h.1" />
    </svg>
  );
}

function NavToolsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 5.5 8.5 9 6.8 10.7 3.3 7.2 5 5.5Zm6.8-1.8 3 3-6.1 6.1a2.2 2.2 0 1 1-3.1-3.1l6.2-6.2Z" />
    </svg>
  );
}

function NavRulesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 4.5h6.2L15 8.3v7.2H5v-11Zm6 0v4h4" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M7.4 10.5h5.2M7.4 13.4h3.8" />
    </svg>
  );
}

function NavCompareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4.5 6h9.2m0 0-2.2-2.2M13.7 6l-2.2 2.2M15.5 14H6.3m0 0 2.2-2.2M6.3 14l2.2 2.2" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M4.5 10h11" />
    </svg>
  );
}

function NavIntegrityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M10 3.5 15.5 5.8v4.5c0 2.8-1.8 4.8-5.5 6.2-3.7-1.4-5.5-3.4-5.5-6.2V5.8L10 3.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m7.4 10.3 1.7 1.7 3.5-4" />
    </svg>
  );
}

function NavPurgeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5.5 7h9l-.7 8.5H6.2L5.5 7Zm2-2h5l.6 2M4.2 7h11.6" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M8.3 10v3M11.7 10v3" />
    </svg>
  );
}

function NavMigrationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 5.5 7.8 3.6l4.3 1.9-4.3 2-4.3-2Zm8.7 0 4.3 1.9-4.3 2-2.1-1" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M7.8 7.5v4l4.4 2.1 4.3-2.1V7.4M7.8 11.5l-4.3-2V5.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m8.7 15.7 2.3-2.1-2.3-2.1" />
    </svg>
  );
}

function NavStackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 6.2 10 3l7 3.2L10 9.5 3 6.2Zm0 4.3L10 14l7-3.5M3 14.2 10 17l7-2.8" />
    </svg>
  );
}

function NavDotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  );
}
