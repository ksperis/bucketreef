/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useDismissibleLayer } from "../../components/ui/useDismissibleLayer";
import type { BrowserItem, ContextMenuState } from "./browserTypes";

const CONTEXT_MENU_PADDING_PX = 8;
const CONTEXT_MENU_FALLBACK_WIDTH_PX = 240;
const CONTEXT_MENU_FALLBACK_HEIGHT_PX = 320;

type ContextMenuPayload = Omit<ContextMenuState, "x" | "y">;

type ContextMenuAnchor = {
  x: number;
  y: number;
  horizontalAlignment?: "start" | "end";
};

type UseBrowserContextMenuOptions = {
  headerConfigurationEnabled: boolean;
  prepareItemActionsMenu: (item: BrowserItem) => void;
  prepareItemContextMenu: (item: BrowserItem) => ContextMenuPayload;
};

function clampContextMenuPosition(
  x: number,
  y: number,
  menuWidth = CONTEXT_MENU_FALLBACK_WIDTH_PX,
  menuHeight = CONTEXT_MENU_FALLBACK_HEIGHT_PX,
) {
  if (typeof window === "undefined") return { x, y };
  const safeWidth =
    Number.isFinite(menuWidth) && menuWidth > 0
      ? menuWidth
      : CONTEXT_MENU_FALLBACK_WIDTH_PX;
  const safeHeight =
    Number.isFinite(menuHeight) && menuHeight > 0
      ? menuHeight
      : CONTEXT_MENU_FALLBACK_HEIGHT_PX;
  const maxX = Math.max(
    CONTEXT_MENU_PADDING_PX,
    window.innerWidth - safeWidth - CONTEXT_MENU_PADDING_PX,
  );
  const maxY = Math.max(
    CONTEXT_MENU_PADDING_PX,
    window.innerHeight - safeHeight - CONTEXT_MENU_PADDING_PX,
  );
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);
  return {
    x: clamp(x, CONTEXT_MENU_PADDING_PX, maxX),
    y: clamp(y, CONTEXT_MENU_PADDING_PX, maxY),
  };
}

export function useBrowserContextMenu({
  headerConfigurationEnabled,
  prepareItemActionsMenu,
  prepareItemContextMenu,
}: UseBrowserContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback(
    (payload: ContextMenuPayload, anchor: ContextMenuAnchor) => {
      const requestedX =
        anchor.horizontalAlignment === "end"
          ? anchor.x - CONTEXT_MENU_FALLBACK_WIDTH_PX
          : anchor.x;
      const position = clampContextMenuPosition(requestedX, anchor.y);
      setContextMenu({ ...payload, ...position });
    },
    [],
  );
  const repositionContextMenu = useCallback(() => {
    setContextMenu((previous) => {
      if (!previous) return previous;
      const menuNode = contextMenuRef.current;
      if (!menuNode) return previous;
      const menuRect = menuNode.getBoundingClientRect();
      const nextPosition = clampContextMenuPosition(
        previous.x,
        previous.y,
        menuRect.width,
        menuRect.height,
      );
      if (
        Math.abs(nextPosition.x - previous.x) < 0.5 &&
        Math.abs(nextPosition.y - previous.y) < 0.5
      ) {
        return previous;
      }
      return { ...previous, ...nextPosition };
    });
  }, []);

  useDismissibleLayer({
    open: Boolean(contextMenu),
    insideRefs: [contextMenuRef],
    onDismiss: closeContextMenu,
  });

  useEffect(() => {
    if (!contextMenu) return;
    const handleScroll = () => closeContextMenu();
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (!contextMenu || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(repositionContextMenu);
    window.addEventListener("resize", repositionContextMenu);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", repositionContextMenu);
    };
  }, [contextMenu, repositionContextMenu]);

  const handleItemContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, item: BrowserItem) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(
        prepareItemContextMenu(item),
        { x: event.clientX, y: event.clientY },
      );
    },
    [openContextMenu, prepareItemContextMenu],
  );

  const handleItemActionsButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, item: BrowserItem) => {
      event.preventDefault();
      event.stopPropagation();
      prepareItemActionsMenu(item);
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenu(
        { kind: "item", item, items: [item] },
        {
          x: rect.right,
          y: rect.bottom + 6,
          horizontalAlignment: "end",
        },
      );
    },
    [openContextMenu, prepareItemActionsMenu],
  );

  const handlePathContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, a, input, textarea, select, label")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(
        { kind: "path" },
        { x: event.clientX, y: event.clientY },
      );
    },
    [openContextMenu],
  );

  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!headerConfigurationEnabled) return;
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(
        { kind: "headerConfig" },
        { x: event.clientX, y: event.clientY },
      );
    },
    [headerConfigurationEnabled, openContextMenu],
  );

  return {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    handleHeaderContextMenu,
    handleItemActionsButtonClick,
    handleItemContextMenu,
    handlePathContextMenu,
    openContextMenu,
  };
}
