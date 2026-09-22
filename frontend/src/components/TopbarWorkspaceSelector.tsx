/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WorkspaceSwitcherModel } from "./EnvironmentSwitcher";
import { CheckIcon, ChevronDownIcon } from "./topbarIcons";
import AnchoredPortalMenu from "./ui/AnchoredPortalMenu";
import { useDismissibleLayer } from "./ui/useDismissibleLayer";

type TopbarWorkspaceSelectorProps = {
  section?: string;
  workspaceSwitcher?: WorkspaceSwitcherModel | null;
};

function compactWorkspaceLabel(label?: string | null): string {
  const normalized = (label ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!normalized) return "Workspace";
  if (normalized.toLowerCase() === "administration") return "Admin";
  return normalized;
}

export default function TopbarWorkspaceSelector({
  section,
  workspaceSwitcher,
}: TopbarWorkspaceSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const options = useMemo(() => workspaceSwitcher?.options ?? [], [workspaceSwitcher]);
  const selectedIndex = useMemo(() => {
    if (!workspaceSwitcher) return -1;
    return options.findIndex((option) => option.value === workspaceSwitcher.currentWorkspaceId);
  }, [options, workspaceSwitcher]);

  useDismissibleLayer({
    open: menuOpen,
    insideRefs: [triggerRef, menuSurfaceRef],
    onDismiss: (reason) => {
      setMenuOpen(false);
      if (reason === "escape") triggerRef.current?.focus();
    },
    preventEscapeDefault: true,
  });

  useEffect(() => {
    if (!menuOpen) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1);
    requestAnimationFrame(() => {
      listboxRef.current?.focus();
    });
  }, [menuOpen, options.length, selectedIndex]);

  useEffect(() => {
    if (!menuOpen) return;
    if (options.length === 0) {
      setActiveIndex(-1);
      return;
    }
    if (activeIndex < 0 || activeIndex >= options.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, menuOpen, options.length]);

  const activateByIndex = (index: number) => {
    if (!workspaceSwitcher) return;
    if (index < 0 || index >= options.length) return;
    const option = options[index];
    setMenuOpen(false);
    if (option.value !== workspaceSwitcher.currentWorkspaceId) {
      workspaceSwitcher.onChange(option.value);
    }
    triggerRef.current?.focus();
  };

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setMenuOpen(false);
      return;
    }
    if (options.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current < 0 ? 0 : (current + 1) % options.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0) activateByIndex(activeIndex);
    }
  };

  const triggerLabel = workspaceSwitcher
    ? compactWorkspaceLabel(workspaceSwitcher.currentWorkspaceLabel)
    : compactWorkspaceLabel(section);

  if (!workspaceSwitcher) {
    return (
      <div className="shell-control flex h-10 w-[140px] min-w-0 items-center gap-2 rounded-lg border px-3">
        <span className="min-w-0 leading-[1.05]">
          <span className="shell-muted-text block truncate text-[10px] font-medium">Workspace</span>
          {triggerLabel && (
            <span className="mt-0.5 block truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
              {triggerLabel}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="relative min-w-0 shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Switch workspace"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? listboxId : undefined}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setMenuOpen(true);
        }}
        className={`shell-control inline-flex h-10 w-[140px] min-w-0 items-center rounded-lg border px-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
          menuOpen ? "shell-control-active" : ""
        }`}
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="shell-muted-text block truncate text-[10px] font-medium">Workspace</span>
          <span className="mt-0.5 block truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
            {triggerLabel}
          </span>
        </span>
        <ChevronDownIcon
          className={`shell-icon-muted ml-2 h-4 w-4 shrink-0 transition-transform ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>

      {menuOpen && (
        <AnchoredPortalMenu
          open={menuOpen}
          anchorRef={triggerRef}
          placement="bottom-start"
          minWidth={240}
          className="shell-menu overflow-hidden rounded-lg border p-1.5"
        >
          <div ref={menuSurfaceRef}>
            <div
              id={listboxId}
              ref={listboxRef}
              className="max-h-72 overflow-y-auto focus:outline-none"
              role="listbox"
              tabIndex={0}
              aria-label="Switch workspace"
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
              onKeyDown={handleListboxKeyDown}
            >
              {options.map((option, index) => {
                const active = workspaceSwitcher.currentWorkspaceId === option.value;
                const highlighted = options[activeIndex]?.value === option.value;
                return (
                  <button
                    key={option.value}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activateByIndex(index)}
                    className={`flex w-full items-start gap-2 rounded-md px-3 py-1.5 text-left transition ${
                      active
                        ? "shell-menu-item-active"
                        : highlighted
                          ? "shell-menu-item-highlighted"
                          : "shell-menu-item hover:bg-[var(--shell-hover)]"
                    }`}
                  >
                    <span className="mt-0.5 h-4 w-4 shrink-0">
                      {active ? <CheckIcon className="h-4 w-4" /> : null}
                    </span>
                    {option.icon && (
                      <span className="shell-icon-muted mt-0.5 h-4 w-4 shrink-0">{option.icon}</span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate ui-caption font-semibold">{option.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </AnchoredPortalMenu>
      )}
    </div>
  );
}
