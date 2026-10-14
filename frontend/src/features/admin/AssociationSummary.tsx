import { ListBadge } from "../../components/list/ListControls";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import type { UiGroupAvatarDescriptor } from "../../api/groups";
import type { UserAvatarDescriptor } from "../../api/users";
import type {
  ManagerAccountRole,
  PortalAccountRole,
} from "../../api/accountAccess";
import GroupAvatar from "../../components/GroupAvatar";
import UserAvatar from "../../components/UserAvatar";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import { buildAdminPrincipalEditHref } from "./adminPrincipalEditLink";
import type { UiLanguage } from "../../components/language";
import { associationSummaryRoleText, associationSummaryText, useAssociationSummaryI18n } from "./associationSummaryMessage";

export type AssociationChipItem = {
  id: number | string;
  label: string;
};

export type AssociationAccountItem = AssociationChipItem & {
  manager_role?: ManagerAccountRole | null;
  portal_role?: PortalAccountRole | null;
};

export type AssociationPrincipalItem = {
  id: number | string;
  kind: "user" | "group";
  label: string;
  email?: string | null;
  avatar?: UserAvatarDescriptor | UiGroupAvatarDescriptor | null;
  manager_role?: ManagerAccountRole | null;
  portal_role?: PortalAccountRole | null;
  role_labels?: string[];
};

export type CompactAssociationItem = {
  id: number | string;
  label: string;
  role_labels?: string[];
};

export type CompactAssociationCategory = {
  id: "accounts" | "s3_users" | "connections";
  label: string;
  itemLabel: string;
  items: CompactAssociationItem[];
};

const DEFAULT_TOOLTIP_LIMIT = 20;
type AssociationRoleTooltipEntry = {
  key: string;
  identity: string;
  kindLabel?: string;
  descriptionKindLabel?: string;
  roles: string[];
};

type AssociationRoleTooltipDetailTone = "semantic" | "neutral";

function roleBadgeTone(role: string): "warning" | "info" | "success" | "neutral" {
  const normalized = role.toLowerCase();
  if (normalized.includes("admin") || normalized.includes("manager")) return "warning";
  if (normalized.includes("portal")) return "info";
  if (normalized.includes("browser")) return "success";
  return "neutral";
}

function isAccessProvenanceLabel(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "direct access" ||
    normalized === "direct or group access" ||
    normalized.startsWith("direct:") ||
    normalized.startsWith("group ")
  );
}

function tooltipDescription(
  label: string,
  entries: AssociationRoleTooltipEntry[],
  remaining: number,
  detailLabel: string,
  locale: UiLanguage,
): string {
  const lines = [
    `${label} (${entries.length + remaining})`,
    ...entries.map((entry) => {
      const identity = `${entry.descriptionKindLabel ? `${entry.descriptionKindLabel}: ` : ""}${entry.identity}`;
      return entry.roles.length > 0 ? `${identity} — ${detailLabel}: ${entry.roles.map(role => associationSummaryRoleText(role, locale)).join(", ")}` : identity;
    }),
  ];
  if (remaining > 0) lines.push(associationSummaryText("moreDescription", locale, { count: remaining }));
  return lines.join("\n");
}

export function AssociationRoleTooltip({
  label,
  entries,
  tooltipLimit = DEFAULT_TOOLTIP_LIMIT,
  ariaLabel,
  focusable = false,
  detailLabel,
  detailTone = "semantic",
  children,
}: {
  label: string;
  entries: AssociationRoleTooltipEntry[];
  tooltipLimit?: number;
  ariaLabel: string;
  focusable?: boolean;
  detailLabel?: string;
  detailTone?: AssociationRoleTooltipDetailTone;
  children: ReactNode;
}) {
  const { locale, text } = useAssociationSummaryI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const descriptionId = useId();
  const boundedLimit = Math.max(1, tooltipLimit);
  const listedEntries = useMemo(() => entries.slice(0, boundedLimit), [boundedLimit, entries]);
  const remaining = entries.length - listedEntries.length;
  const description = tooltipDescription(label, listedEntries, remaining, detailLabel ?? text("roles"), locale);

  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const openTooltip = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };
  const handleBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
  };

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  return (
    <span
      ref={anchorRef}
      className="ui-list-association-trigger relative inline-flex max-w-full"
      aria-label={ariaLabel}
      aria-describedby={descriptionId}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={openTooltip}
      onMouseLeave={scheduleClose}
      onFocusCapture={openTooltip}
      onBlurCapture={handleBlur}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {children}
      <span id={descriptionId} className="sr-only whitespace-pre-line">{description}</span>
      <AnchoredPortalMenu
        open={open}
        anchorRef={anchorRef}
        placement="bottom-start"
        offset={4}
        minWidth={420}
        className="pointer-events-auto max-h-[calc(100vh-1rem)] w-[32rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <div
          role="tooltip"
          aria-label={text("details", { label })}
          onMouseEnter={openTooltip}
          onMouseLeave={scheduleClose}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1 dark:border-slate-800">
            <p className="text-[11px] font-semibold leading-4 text-slate-900 dark:text-slate-100">{label}</p>
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {text("total", { count: entries.length })}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {listedEntries.map((entry) => (
              <div key={entry.key} className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 py-1">
                <div className="flex min-w-0 flex-1 items-baseline gap-1">
                  {entry.kindLabel ? (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {entry.kindLabel}
                    </span>
                  ) : null}
                  <span className="min-w-0 break-words whitespace-normal text-[11px] font-medium leading-4 text-slate-800 dark:text-slate-100">
                    {entry.identity}
                  </span>
                </div>
                {entry.roles.length > 0 ? (
                  <div className="flex max-w-[58%] shrink-0 flex-wrap justify-end gap-0.5">
                    {entry.roles.map((role) => (
                      <ListBadge
                        key={`${entry.key}:${role}`}
                        tone={detailTone === "neutral" ? "neutral" : roleBadgeTone(role)}
                      >
                        {associationSummaryRoleText(role, locale)}
                      </ListBadge>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {remaining > 0 ? (
            <p className="border-t border-slate-100 pt-1 text-[10px] font-medium leading-4 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {text(remaining === 1 ? "moreEntry" : "moreEntries", { count: remaining })}
            </p>
          ) : null}
        </div>
      </AnchoredPortalMenu>
    </span>
  );
}

export function accountAssociationRoleLabels(account: AssociationAccountItem, locale: UiLanguage = "en"): string[] {
  const roles: string[] = [];
  if (account.manager_role === "account_administrator") {
    roles.push(associationSummaryText("accountAdministrator", locale));
  }
  if (account.portal_role === "portal_manager") roles.push(associationSummaryText("portalManager", locale));
  if (account.portal_role === "portal_user") roles.push(associationSummaryText("portalUser", locale));
  if (roles.length === 0) roles.push(associationSummaryText("member", locale));
  return roles;
}

export function uiPrincipalRoleLabel(role?: string | null, locale: UiLanguage = "en"): string {
  const normalized = (role ?? "").toLowerCase();
  if (["ui_superadmin", "super_admin", "superadmin"].includes(normalized)) return associationSummaryText("superadmin", locale);
  if (["ui_admin", "account_admin", "admin"].includes(normalized)) return associationSummaryText("admin", locale);
  if (["ui_none", "none"].includes(normalized)) return associationSummaryText("noUiAccess", locale);
  if (["ui_user", "account_user", "user"].includes(normalized)) return associationSummaryText("user", locale);
  return role?.trim() || associationSummaryText("user", locale);
}

export function CompactAssociationSummary({
  categories,
  tooltipLimit = DEFAULT_TOOLTIP_LIMIT,
}: {
  categories: CompactAssociationCategory[];
  tooltipLimit?: number;
}) {
  const { text } = useAssociationSummaryI18n();
  const visibleCategories = categories.filter((category) => category.items.length > 0);
  if (visibleCategories.length === 0) {
    return <span className="ui-caption text-slate-500 dark:text-slate-400">{text("none")}</span>;
  }
  const total = visibleCategories.reduce((sum, category) => sum + category.items.length, 0);
  const entries = visibleCategories.flatMap((category) =>
    category.items.map((item) => ({
      key: `${category.id}:${item.id}`,
      kindLabel: category.itemLabel,
      descriptionKindLabel: category.itemLabel,
      identity: item.label,
      roles: (item.role_labels ?? []).filter((role) => !isAccessProvenanceLabel(role)),
    })),
  );
  return (
    <AssociationRoleTooltip
      label={text("linkedAssociations")}
      entries={entries}
      tooltipLimit={tooltipLimit}
      ariaLabel={text(total === 1 ? "linkedAssociationCount" : "linkedAssociationsCount", { count: total })}
      focusable
    >
      <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
        {visibleCategories.map((category) => (
          <ListBadge
            key={category.id}
            disableToneStyles className={`gap-1 ui-list-association-${category.id}`}
          >
            <span>{category.label}</span>
            <span aria-label={text("categoryCount", { count: category.items.length, category: category.label.toLowerCase() })}>{category.items.length}</span>
          </ListBadge>
        ))}
      </span>
    </AssociationRoleTooltip>
  );
}

function principalTooltipEntry(item: AssociationPrincipalItem, locale: UiLanguage): AssociationRoleTooltipEntry {
  const identity = item.email && item.email !== item.label ? `${item.label} · ${item.email}` : item.label;
  const roles: string[] = [...(item.role_labels ?? [])];
  const kindLabel = associationSummaryText(item.kind === "group" ? "uiGroup" : "uiUser", locale);
  if (item.manager_role === "account_administrator") {
    roles.push(associationSummaryText("accountAdministrator"));
  }
  if (item.portal_role === "portal_manager") roles.push(associationSummaryText("portalManager"));
  if (item.portal_role === "portal_user") roles.push(associationSummaryText("portalUser"));
  return {
    key: `${item.kind}:${item.id}`,
    identity,
    kindLabel,
    descriptionKindLabel: kindLabel,
    roles,
  };
}

export function AssociationPrincipalStack({
  items,
  maxVisible = 5,
  tooltipLimit = DEFAULT_TOOLTIP_LIMIT,
}: {
  items: AssociationPrincipalItem[];
  maxVisible?: number;
  tooltipLimit?: number;
}) {
  const { locale, text } = useAssociationSummaryI18n();
  if (items.length === 0) return <span className="ui-caption text-slate-500 dark:text-slate-400">{text("none")}</span>;
  const visible = items.slice(0, maxVisible);
  const remaining = items.length - visible.length;
  const entries = items.map(item => principalTooltipEntry(item, locale));
  return (
    <AssociationRoleTooltip
      label={text("linkedPrincipals")}
      entries={entries}
      tooltipLimit={tooltipLimit}
      ariaLabel={text(items.length === 1 ? "linkedPrincipalCount" : "linkedPrincipalsCount", { count: items.length })}
    >
      <span className="inline-flex items-center -space-x-1.5">{visible.map((item) => {
        const principalType = text(item.kind === "group" ? "uiGroup" : "uiUser");
        const href = buildAdminPrincipalEditHref({
          id: item.id,
          kind: item.kind,
          search: item.email || item.label,
        });
        return (
          <a
            key={`${item.kind}-${item.id}`}
            href={href}
            aria-label={text("editPrincipal", { kind: principalType, label: item.label })}
            className={`group relative inline-flex shrink-0 transition-transform hover:z-20 hover:-translate-y-0.5 focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface)] ${
              item.kind === "group" ? "rounded-lg" : "rounded-full"
            }`}
          >
            {item.kind === "group" ? (
              <GroupAvatar
                name={item.label}
                avatar={item.avatar as UiGroupAvatarDescriptor | null | undefined}
                size="sm"
                decorative
              />
            ) : (
              <UserAvatar
                name={item.label}
                email={item.email}
                avatar={item.avatar as UserAvatarDescriptor | null | undefined}
                size="sm"
                decorative
              />
            )}
          </a>
        );
      })}
      {remaining > 0 ? (
        <span
          aria-hidden="true"
          className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ui-surface)] bg-slate-200 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100"
        >
          +{remaining}
        </span>
      ) : null}
      </span>
    </AssociationRoleTooltip>
  );
}
