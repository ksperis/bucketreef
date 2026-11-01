/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx, uiCardClass } from "../../components/ui/styles";
import UiIconButton from "../../components/ui/UiIconButton";
import type { BrowserBucket } from "../../api/browserContracts";
import { FolderIcon, RefreshIcon, XIcon } from "./browserIcons";
import {
  treeItemActiveClasses,
  treeItemBaseClasses,
  treeItemInactiveClasses,
  treeToggleButtonClasses,
} from "./browserConstants";
import type { TreeNode } from "./browserTypes";
import type { BucketAccessEntry } from "./browserBucketModel";
import { useBrowserI18n, type BrowserTextFn } from "./browserI18n";
import {
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
} from "./browserRootUiState";
import {
  PANEL_LAYOUT_GAP_PX,
  PANEL_RESIZER_HITBOX_WIDTH_PX,
} from "./browserPanelLayout";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEventHandler,
} from "react";

type BrowserFoldersPanelResize = {
  active: boolean;
  widthPx: number;
  onAdjustWidth: (deltaPx: number) => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onResetWidth: () => void;
};

type BrowserFoldersPanelProps = {
  currentBucket: BrowserBucket | null;
  activePrefix: string;
  currentBucketAccess: BucketAccessEntry;
  treeRootNode: TreeNode | null;
  workspaceNoun?: string;
  onClose: () => void;
  onRefresh: () => void;
  onSelectPrefix: (prefix: string) => void;
  onToggleTreeNode: (node: TreeNode) => void;
  resize: BrowserFoldersPanelResize;
};

const panelSectionTitleClasses =
  "ui-caption font-semibold text-slate-500 dark:text-slate-400";

function renderTreeNodes(
  nodes: TreeNode[],
  activePrefix: string,
  depth: number,
  onSelectPrefix: (prefix: string) => void,
  onToggleTreeNode: (node: TreeNode) => void,
  text: BrowserTextFn,
): JSX.Element {
  return (
    <ul className="w-full min-w-0 space-y-1">
      {nodes.map((node) => {
        const isActive = activePrefix === node.prefix;
        const canToggle = node.isLoaded ? node.children.length > 0 : true;
        const labelClasses = `${treeItemBaseClasses} min-h-8 rounded-md px-2 py-1 ${
          isActive ? treeItemActiveClasses : treeItemInactiveClasses
        }`;
        return (
          <li key={node.id}>
            <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: depth * 12 }}>
              <button
                type="button"
                className={`${treeToggleButtonClasses} mt-1 h-5 w-5 rounded-md`}
                onClick={() => onToggleTreeNode(node)}
                disabled={!canToggle}
                aria-label={node.isExpanded
                  ? text("Collapse {name}", { name: node.name })
                  : text("Expand {name}", { name: node.name })}
                title={node.isExpanded ? text("Collapse") : text("Expand")}
              >
                {canToggle ? (node.isExpanded ? "-" : "+") : ""}
              </button>
              <button
                type="button"
                className={labelClasses}
                onClick={() => onSelectPrefix(node.prefix)}
                title={node.name}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </div>
            {node.isExpanded && (node.isLoading || node.children.length > 0) && (
              <div className="mt-1">
                {node.isLoading ? (
                  <div className="pl-8 ui-caption text-slate-400 dark:text-slate-500">{text("Loading folders...")}</div>
                ) : (
                  renderTreeNodes(node.children, activePrefix, depth + 1, onSelectPrefix, onToggleTreeNode, text)
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function BrowserFoldersPanel({
  currentBucket,
  activePrefix,
  currentBucketAccess,
  treeRootNode,
  workspaceNoun = "bucket",
  onClose,
  onRefresh,
  onSelectPrefix,
  onToggleTreeNode,
  resize,
}: BrowserFoldersPanelProps) {
  const { text } = useBrowserI18n();
  const currentBucketChildren = treeRootNode?.children ?? [];
  const currentBucketLoading = Boolean(currentBucket && treeRootNode?.isLoading);
  const currentBucketHasFolders = currentBucketChildren.length > 0;
  const currentBucketUnavailable = currentBucketAccess.status === "unavailable";
  const normalizedWorkspaceNoun = workspaceNoun.trim() || "bucket";
  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resize.onAdjustWidth(-16);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      resize.onAdjustWidth(16);
    } else if (event.key === "Home") {
      event.preventDefault();
      resize.onResetWidth();
    }
  };

  return (
    <>
      <div className={cx(uiCardClass, "flex h-full min-h-0 min-w-0 flex-col p-3")}>
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={panelSectionTitleClasses}>{text("Folders")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <UiIconButton
              variant="ghost"
              className="shrink-0"
              onClick={onRefresh}
              disabled={!currentBucket}
              label={text("Refresh folders")}
              icon={<RefreshIcon className="h-3.5 w-3.5" />}
            />
            <UiIconButton
              variant="ghost"
              className="shrink-0"
              onClick={onClose}
              label={text("Close folders panel")}
              icon={<XIcon className="h-3.5 w-3.5" />}
            />
          </div>
        </div>

        <section className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1" aria-label={text("Current {workspace}", { workspace: normalizedWorkspaceNoun })}>
          <div className="min-w-0">
            <button
              type="button"
              className={`${treeItemBaseClasses} min-h-8 rounded-md px-2 py-1 ${
                activePrefix === "" ? treeItemActiveClasses : treeItemInactiveClasses
              }`}
              onClick={() => onSelectPrefix("")}
              disabled={!currentBucket}
            >
              <FolderIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{text("Root")}</span>
            </button>

            <div className="mt-2 min-w-0">
              {!currentBucket && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {text("Select a {workspace} to browse folders.", { workspace: normalizedWorkspaceNoun })}
                </p>
              )}
              {currentBucket && currentBucketUnavailable && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {text("Folder tree unavailable with current credentials.")}</p>
              )}
              {currentBucketLoading && !currentBucketUnavailable && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">{text("Loading folders...")}</p>
              )}
              {currentBucket && !currentBucketUnavailable && !currentBucketLoading && !currentBucketHasFolders && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">{text("No folders at this level.")}</p>
              )}
              {!currentBucketUnavailable && currentBucketHasFolders &&
                renderTreeNodes(currentBucketChildren, activePrefix, 0, onSelectPrefix, onToggleTreeNode, text)}
            </div>
          </div>
        </section>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={text("Resize folders panel")}
        aria-valuemin={MIN_FOLDERS_PANEL_WIDTH_PX}
        aria-valuemax={MAX_FOLDERS_PANEL_WIDTH_PX}
        aria-valuenow={resize.widthPx}
        title={text("Resize folders panel")}
        tabIndex={0}
        className="absolute inset-y-0 z-20 -translate-x-1/2 cursor-col-resize touch-none select-none"
        style={{
          left: `calc(${resize.widthPx}px + ${PANEL_LAYOUT_GAP_PX / 2}px)`,
          width: `${PANEL_RESIZER_HITBOX_WIDTH_PX}px`,
        }}
        onPointerDown={resize.onPointerDown}
        onKeyDown={handleResizeKeyDown}
        onDoubleClick={resize.onResetWidth}
      >
        <div
          className={`mx-auto h-full w-0.5 rounded-full bg-slate-200 transition dark:bg-slate-700 ${
            resize.active
              ? "bg-primary dark:bg-primary-300"
              : "hover:bg-slate-300 dark:hover:bg-slate-500"
          }`}
        />
      </div>
    </>
  );
}
