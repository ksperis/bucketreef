/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, NavLink, useLocation } from "react-router-dom";
import { PRODUCT_NAME } from "../constants/product";
import { resolveWorkspaceProfilePath } from "../navigation/workspacePages";
import {
  readClientJsonFromKey,
  writeClientJsonToKey,
} from "../utils/clientStorage";
import BrandMark from "./BrandMark";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { resolveSidebarLinkIcon, type SidebarLinkIconName } from "./sidebarIcons";
import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_DEFAULT_WIDTH } from "./sidebarSizing";
import { useShellI18n } from "./shellMessages";

export type SidebarLink = {
  to: string;
  label: string;
  badge?: string;
  badgeAriaLabel?: string;
  badgeTone?: "neutral" | "attention";
  end?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  iconName?: SidebarLinkIconName;
  icon?: ReactNode;
};

function compactLinkLabel(link: SidebarLink): string {
  return link.badgeAriaLabel ? `${link.label}, ${link.badgeAriaLabel}` : link.label;
}

function SidebarLinkBadge({
  link,
  active,
  compact,
}: {
  link: SidebarLink;
  active: boolean;
  compact: boolean;
}) {
  if (!link.badge) return null;
  const highlighted = link.badgeTone === "attention" || active;
  const positionClasses = compact
    ? "absolute right-0.5 top-0.5 min-w-4 px-1 py-px text-[9px] leading-3"
    : "shrink-0 px-1.5 py-0.5 ui-caption";
  const toneClasses = highlighted
    ? "bg-primary/15 text-primary-700 dark:text-primary-200"
    : "shell-menu-muted shell-muted-text";

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold ${positionClasses} ${toneClasses}`}
      aria-label={link.badgeAriaLabel}
    >
      {link.badge}
    </span>
  );
}

export type SidebarSection = {
  id?: string;
  label?: string;
  links: SidebarLink[];
  collapsed?: boolean;
  collapsible?: boolean;
};

export type SidebarBodyRenderArgs = {
  compact: boolean;
  variant: "desktop" | "mobile";
  closeMobile: () => void;
};

type SidebarProps = {
  title?: string;
  sections?: SidebarSection[];
  links?: SidebarLink[];
  headerAction?: ReactNode;
  footer?: ReactNode;
  renderSidebarBody?: (args: SidebarBodyRenderArgs) => ReactNode;
  variant?: "desktop" | "mobile";
  className?: string;
  onNavigate?: () => void;
  compact?: boolean;
  onCollapseToggle?: () => void;
};

function isSectionCollapsible(section: SidebarSection) {
  return Boolean(section.label && section.collapsible);
}

function sidebarSectionStorageKey(title: string, pathname: string) {
  const workspace = pathname.split("/").find(Boolean)?.trim().toLowerCase();
  const scope = workspace || title.trim().toLowerCase() || "default";
  return `shell:sidebar-sections:v1:${scope}`;
}

function sidebarSectionStateKey(section: SidebarSection, index: number) {
  return section.id?.trim() || `section-${index}`;
}

function sidebarSectionPersistenceKey(section: SidebarSection) {
  return section.id?.trim() || null;
}

function storedSidebarSectionState(
  stored: Record<string, boolean> | null,
  section: SidebarSection,
): boolean | undefined {
  const persistenceKey = sidebarSectionPersistenceKey(section);
  return persistenceKey ? stored?.[persistenceKey] : undefined;
}

function sidebarLinkMatchesPath(link: SidebarLink, pathname: string) {
  const path = link.to.split(/[?#]/, 1)[0] || "/";
  return Boolean(matchPath({ path, end: link.end ?? false }, pathname));
}

function CompactSidebarHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  const show = () => {
    setDismissed(false);
    setVisible(true);
  };

  return (
    <span
      ref={anchorRef}
      className="block"
      onMouseEnter={show}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={show}
      onBlurCapture={() => setVisible(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDismissed(true);
          setVisible(false);
        }
      }}
    >
      {children}
      <AnchoredPortalMenu
        open={visible && !dismissed}
        anchorRef={anchorRef}
        placement="right-center"
        offset={8}
        minWidth={0}
        className="shell-sidebar-tooltip"
      >
        <span role="tooltip">{label}</span>
      </AnchoredPortalMenu>
    </span>
  );
}

export default function Sidebar({
  title = PRODUCT_NAME,
  sections,
  links = [],
  headerAction,
  footer,
  renderSidebarBody,
  variant = "desktop",
  className,
  onNavigate,
  compact = false,
  onCollapseToggle,
}: SidebarProps) {
  const { text } = useShellI18n();
  const effectiveSections: SidebarSection[] = useMemo(
    () => (sections && sections.length > 0 ? sections : links.length > 0 ? [{ label: text("navigation"), links }] : []),
    [links, sections, text]
  );
  const location = useLocation();
  const profilePath = resolveWorkspaceProfilePath(location.pathname);
  const collapsedStorageKey = useMemo(
    () => sidebarSectionStorageKey(title, location.pathname),
    [location.pathname, title],
  );

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const stored = readClientJsonFromKey<Record<string, boolean>>(
      sidebarSectionStorageKey(title, location.pathname),
    );
    const initial: Record<string, boolean> = {};
    effectiveSections.forEach((section, index) => {
      const stateKey = sidebarSectionStateKey(section, index);
      if (section.label) {
        initial[stateKey] = isSectionCollapsible(section)
          ? section.collapsed === false
            ? false
            : storedSidebarSectionState(stored, section) ?? section.collapsed ?? false
          : false;
      }
    });
    return initial;
  });
  const [activeSectionCollapseOverrides, setActiveSectionCollapseOverrides] = useState<Record<string, boolean>>({});
  const [navScrolling, setNavScrolling] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const navScrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = readClientJsonFromKey<Record<string, boolean>>(collapsedStorageKey);
    setCollapsedSections((previous) => {
      const next: Record<string, boolean> = {};
      effectiveSections.forEach((section, index) => {
        if (!section.label) return;
        const stateKey = sidebarSectionStateKey(section, index);
        const collapsible = isSectionCollapsible(section);
        if (!collapsible) {
          next[stateKey] = false;
        } else if (section.collapsed === false) {
          next[stateKey] = false;
        } else {
          next[stateKey] =
            storedSidebarSectionState(stored, section) ??
            previous[stateKey] ??
            section.collapsed ??
            false;
        }
      });
      return next;
    });
  }, [collapsedStorageKey, effectiveSections]);

  useEffect(() => {
    const activeLink = navRef.current?.querySelector<HTMLElement>(".shell-sidebar-item-active");
    activeLink?.scrollIntoView?.({ block: "nearest" });
  }, [collapsedSections, compact, location.pathname]);

  useEffect(() => {
    setActiveSectionCollapseOverrides({});
  }, [location.pathname]);

  const toggleSection = (
    stateKey: string,
    persistenceKey: string | null,
    collapsible: boolean,
    activeSection: boolean,
    isCollapsed: boolean,
  ) => {
    if (!collapsible) return;
    const nextCollapsed = !isCollapsed;
    setActiveSectionCollapseOverrides((previous) => {
      if (!activeSection) {
        if (!(stateKey in previous)) return previous;
        const next = { ...previous };
        delete next[stateKey];
        return next;
      }
      return {
        ...previous,
        [stateKey]: nextCollapsed,
      };
    });
    setCollapsedSections((prev) => {
      const next = {
        ...prev,
        [stateKey]: nextCollapsed,
      };
      if (persistenceKey) {
        const persisted = effectiveSections.reduce<Record<string, boolean>>((result, section, index) => {
          const sectionPersistenceKey = sidebarSectionPersistenceKey(section);
          if (!sectionPersistenceKey || !isSectionCollapsible(section)) return result;
          const sectionStateKey = sidebarSectionStateKey(section, index);
          result[sectionPersistenceKey] = sectionStateKey === stateKey
            ? nextCollapsed
            : Boolean(next[sectionStateKey]);
          return result;
        }, {});
        writeClientJsonToKey(collapsedStorageKey, persisted);
      }
      return next;
    });
  };

  useEffect(() => {
    return () => {
      if (navScrollTimeoutRef.current !== null) {
        window.clearTimeout(navScrollTimeoutRef.current);
      }
    };
  }, []);

  const handleNavScroll = () => {
    setNavScrolling(true);
    if (navScrollTimeoutRef.current !== null) {
      window.clearTimeout(navScrollTimeoutRef.current);
    }
    navScrollTimeoutRef.current = window.setTimeout(() => {
      setNavScrolling(false);
      navScrollTimeoutRef.current = null;
    }, 900);
  };

  const baseLinkClasses = compact
    ? "shell-sidebar-action group relative flex h-8 items-center justify-center rounded-md px-2 text-[12px] font-medium leading-4 transition"
    : "shell-sidebar-action group relative flex h-9 items-center justify-between gap-2 overflow-hidden rounded-md px-2.5 text-[12px] font-medium leading-4 transition";
  const inactiveLinkClasses = "shell-sidebar-item";
  const activeLinkClasses =
    compact
      ? "shell-sidebar-item-active"
      : "shell-sidebar-item-active before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary dark:before:bg-primary-400";
  const containerClasses =
    variant === "desktop"
      ? "shell-sidebar relative hidden h-full shrink-0 border-r md:flex md:flex-col transition-[width] duration-200 ease-out"
      : "shell-sidebar flex h-full flex-col border-r";
  const rootClassName = className ? `${containerClasses} ${className}` : containerClasses;
  const iconClasses = "h-4 w-4";
  const navSpacingClasses = compact ? "gap-1.5 pb-3 pt-3" : "gap-2 px-2.5 pb-3 pt-3";
  const rootStyle: CSSProperties | undefined =
    variant === "desktop"
      ? {
          width: `${compact ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_DEFAULT_WIDTH}px`,
        }
      : undefined;
  const customBody = renderSidebarBody
    ? renderSidebarBody({
        compact,
        variant,
        closeMobile: onNavigate ?? (() => undefined),
      })
    : null;

  return (
    <aside className={rootClassName} style={rootStyle} data-sidebar-variant={variant}>
      <div className={`relative flex h-14 shrink-0 items-center ${compact ? "justify-center px-2" : "gap-3 px-4"}`}>
        {compact && variant === "desktop" && onCollapseToggle ? (
          <button
            type="button"
            onClick={onCollapseToggle}
            aria-label={text("expandSidebar")}
            title={text("expandSidebar")}
            className="shell-touch-target group relative flex h-10 w-10 items-center justify-center rounded-lg bg-transparent transition-colors hover:bg-[var(--shell-hover)] focus:outline-none focus-visible:bg-[var(--shell-hover)] focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--shell-sidebar-bg)]"
          >
            <span className="absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-150 group-hover:scale-75 group-hover:opacity-0 group-focus-visible:scale-75 group-focus-visible:opacity-0">
              <BrandMark className="h-9 w-9" />
            </span>
            <ExpandIcon
              aria-hidden="true"
              className="h-5 w-5 scale-75 text-[var(--shell-text)] opacity-0 transition-[opacity,transform] duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
            />
          </button>
        ) : (
          <>
            <BrandMark className="h-9 w-9" />
            {!compact && <span className="truncate text-[14px] font-semibold leading-none text-[var(--shell-text)]">{PRODUCT_NAME}</span>}
            {variant === "desktop" && onCollapseToggle ? (
              <button
                type="button"
                onClick={onCollapseToggle}
                aria-label={text("collapseSidebar")}
                title={text("collapseSidebar")}
                className="shell-sidebar-item shell-touch-target ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--shell-muted)] transition-colors hover:text-[var(--shell-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                <CollapseIcon className="h-4 w-4" />
              </button>
            ) : null}
          </>
        )}
      </div>
      {customBody ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{customBody}</div>
      ) : (
        <>
          <nav
            ref={navRef}
            className={`shell-sidebar-scroll ${compact ? "shell-sidebar-scroll-compact" : ""} flex min-h-0 flex-1 flex-col overflow-y-auto ${navScrolling ? "shell-sidebar-scroll-active" : ""} ${navSpacingClasses}`}
            onScroll={handleNavScroll}
            aria-label={text("navigationAria", { title })}
          >
            {!compact && headerAction ? <div className="pb-1">{headerAction}</div> : null}
            {effectiveSections.map((section, index) => {
              const collapsible = isSectionCollapsible(section);
              const sectionStateKey = sidebarSectionStateKey(section, index);
              const sectionPersistenceKey = sidebarSectionPersistenceKey(section);
              const activeSection = section.links.some((link) => sidebarLinkMatchesPath(link, location.pathname));
              const isCollapsed =
                compact || !section.label
                  ? false
                  : activeSection && activeSectionCollapseOverrides[sectionStateKey]
                    ? true
                    : Boolean(collapsedSections[sectionStateKey] && !activeSection);
              const showSeparator = index < effectiveSections.length - 1;
              return (
                <section
                  key={section.id ?? section.label ?? `untitled-${index}`}
                  className={`${showSeparator && !compact ? "border-b border-[color:var(--shell-border-soft)] pb-3" : ""} ${compact ? "shell-sidebar-compact-rail" : ""} space-y-1.5`}
                >
                  {compact ? (
                    index > 0 ? (
                      <div
                        aria-hidden="true"
                        className="shell-sidebar-compact-divider mx-auto my-1 h-px w-5 rounded-full bg-[var(--shell-border-soft)]"
                      />
                    ) : null
                  ) : !section.label ? null : collapsible ? (
                    <button
                      type="button"
                      onClick={() => toggleSection(
                        sectionStateKey,
                        sectionPersistenceKey,
                        collapsible,
                        activeSection,
                        isCollapsed,
                      )}
                      className="shell-section-label shell-sidebar-section-toggle flex h-5 w-full items-center justify-between rounded-md px-2 text-[10px] font-semibold uppercase transition hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]"
                    >
                      <span>{section.label}</span>
                      <SidebarChevronIcon className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                    </button>
                  ) : (
                    <div className="shell-section-label px-2 text-[10px] font-semibold uppercase">
                      {section.label}
                    </div>
                  )}
                  {!isCollapsed && (
                    <ul className="space-y-px">
                      {section.links.map((link) => (
                        <li key={link.to}>
                          {link.disabled ? (
                            compact ? (
                              <CompactSidebarHint label={link.disabledHint ?? text("unavailableContext")}>
                                <div
                                  className={`${baseLinkClasses} ${inactiveLinkClasses} cursor-not-allowed opacity-50`}
                                  aria-disabled="true"
                                  aria-label={compactLinkLabel(link)}
                                >
                                  <span className={`shell-icon-muted shrink-0 ${iconClasses}`}>
                                    {link.icon ?? resolveSidebarLinkIcon(link)}
                                  </span>
                                  <SidebarLinkBadge link={link} active={false} compact />
                                </div>
                              </CompactSidebarHint>
                            ) : (
                            <div
                              className={`${baseLinkClasses} ${inactiveLinkClasses} cursor-not-allowed opacity-50`}
                              aria-disabled="true"
                              aria-label={compact ? compactLinkLabel(link) : undefined}
                              title={link.disabledHint ?? text("unavailableContext")}
                            >
                              <div className={`flex min-w-0 items-center ${compact ? "" : "gap-1.5"}`}>
                                <span className={`shell-icon-muted shrink-0 ${iconClasses}`}>
                                  {link.icon ?? resolveSidebarLinkIcon(link)}
                                </span>
                                {!compact && <span className="truncate">{link.label}</span>}
                              </div>
                              <SidebarLinkBadge link={link} active={false} compact={compact} />
                            </div>
                            )
                          ) : (
                            (() => {
                              const navLink = (
                                <NavLink
                                  to={link.to}
                                  end={link.end}
                                  onClick={onNavigate}
                                  aria-label={compact ? compactLinkLabel(link) : undefined}
                                  className={({ isActive }) =>
                                    [baseLinkClasses, isActive ? activeLinkClasses : inactiveLinkClasses].join(" ")
                                  }
                                >
                                  {({ isActive }) => (
                                    <>
                                      <div className={`flex min-w-0 items-center ${compact ? "" : "gap-1.5"}`}>
                                        <span
                                          className={`shrink-0 ${
                                            isActive
                                              ? "text-[var(--shell-text)]"
                                              : "shell-icon-muted group-hover:text-[var(--shell-icon)]"
                                          } ${iconClasses}`}
                                        >
                                          {link.icon ?? resolveSidebarLinkIcon(link)}
                                        </span>
                                        {!compact && <span className="truncate">{link.label}</span>}
                                      </div>
                                      <SidebarLinkBadge link={link} active={isActive} compact={compact} />
                                    </>
                                  )}
                                </NavLink>
                              );
                              return compact ? (
                                <CompactSidebarHint label={compactLinkLabel(link)}>
                                  {navLink}
                                </CompactSidebarHint>
                              ) : navLink;
                            })()
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </nav>
          {footer ? <div className={`shrink-0 overflow-hidden border-t border-[color:var(--shell-border)] text-[var(--shell-text)] ${compact ? "p-2" : "p-3"}`}>{footer}</div> : null}
        </>
      )}
      <div className={`shrink-0 border-t border-[color:var(--shell-border)] ${compact ? "p-2" : "p-2.5"}`}>
        {compact ? (
          <CompactSidebarHint label={text("profile")}>
            <NavLink
              to={profilePath}
              onClick={onNavigate}
              aria-label={text("profile")}
              className={({ isActive }) =>
                `${baseLinkClasses} mx-auto w-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${isActive ? activeLinkClasses : inactiveLinkClasses}`
              }
            >
              <UserProfileIcon className="h-4 w-4 shrink-0" />
            </NavLink>
          </CompactSidebarHint>
        ) : (
          <NavLink
          to={profilePath}
          onClick={onNavigate}
          className={({ isActive }) =>
            `${baseLinkClasses} w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${isActive ? activeLinkClasses : inactiveLinkClasses}`
          }
        >
          <div className={`flex min-w-0 items-center ${compact ? "" : "gap-1.5"}`}>
            <UserProfileIcon className="h-4 w-4 shrink-0" />
            {!compact && <span className="truncate">{text("profile")}</span>}
          </div>
        </NavLink>
        )}
      </div>
    </aside>
  );
}

function SidebarChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m7 5 6 5-6 5" />
    </svg>
  );
}

function CollapseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m12 5-5 5 5 5" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M15 4.5v11" />
    </svg>
  );
}

function ExpandIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m8 5 5 5-5 5" />
      <path strokeLinecap="round" strokeWidth={1.7} d="M5 4.5v11" />
    </svg>
  );
}

function UserProfileIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" {...props}>
      <circle cx="10" cy="6.5" r="3" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeWidth={1.6} d="M4.5 16c.7-3 2.5-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
    </svg>
  );
}
