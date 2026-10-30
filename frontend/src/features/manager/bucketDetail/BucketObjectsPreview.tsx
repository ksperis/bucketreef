/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ListActionButton } from "../../../components/list/ListControls";
import SplitView from "../../../components/SplitView";
import UiInlineMessage from "../../../components/ui/UiInlineMessage";
import {
  uiDataTableClass,
  uiTableContainerClass,
} from "../../../components/ui/styles";
import { formatBytes } from "../../../utils/format";
import { useManagerI18n } from "../managerI18n";
import type { useBucketObjectsController } from "./useBucketObjectsController";

type BucketObjectsPreviewProps = {
  bucketName?: string;
  controller: ReturnType<typeof useBucketObjectsController>;
  isCephAdmin: boolean;
  managerBrowserAvailable: boolean;
};

const hintClass = "settings-description";
const tightStackClass = "space-y-1";
const tableDividerClass = "divide-y divide-slate-200 dark:divide-slate-800";

export default function BucketObjectsPreview({
  bucketName,
  controller,
  isCephAdmin,
  managerBrowserAvailable,
}: BucketObjectsPreviewProps) {
  const { text, intlLocale } = useManagerI18n();
  const {
    currentPrefix,
    error,
    loading,
    openPrefix,
    parentPrefix,
    prefixes,
    rows,
  } = controller;

  return (
    <SplitView
      left={
        <div className="space-y-2 p-3">
          <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
            {text("Prefixes")}
          </p>
          <div className={tightStackClass}>
            <ListActionButton
              variant="ghost"
              active={currentPrefix === ""}
              aria-pressed={currentPrefix === ""}
              className="w-full !justify-between text-left"
              onClick={() => openPrefix("")}
            >
              <span>{text("(root)")}</span>
            </ListActionButton>
            {parentPrefix !== "" && (
              <ListActionButton
                variant="ghost"
                className="w-full !justify-between text-left"
                onClick={() => openPrefix(parentPrefix)}
              >
                <span>{text("⬆️ Up")}</span>
                <span className={hintClass}>{parentPrefix || "/"}</span>
              </ListActionButton>
            )}
            {prefixes.map((prefix) => {
              const isActive = prefix === currentPrefix;
              const displayName = prefix.replace(currentPrefix, "") || prefix;
              return (
                <ListActionButton
                  key={prefix}
                  variant="ghost"
                  active={isActive}
                  aria-pressed={isActive}
                  className="w-full !justify-between text-left"
                  onClick={() => openPrefix(prefix)}
                >
                  <span>{displayName}</span>
                </ListActionButton>
              );
            })}
          </div>
        </div>
      }
      right={
        <div className="space-y-3 p-4">
          <div className={tightStackClass}>
            <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
              {text("Path")}
            </p>
            <div className="ui-caption text-slate-500 dark:text-slate-300">
              {bucketName}/{currentPrefix || "(root)"}
            </div>
            <div className={hintClass}>
              {isCephAdmin
                ? text("Read-only preview using the selected endpoint's Ceph Admin credentials.")
                : managerBrowserAvailable
                  ? text("Read-only preview. Use the main Browser page for object operations.")
                  : text("Read-only preview. Object operations are unavailable because Manager Browser is disabled.")}
            </div>
          </div>
          {error && <UiInlineMessage tone="error">{text(error)}</UiInlineMessage>}

          <div className={uiTableContainerClass}>
            <table className={uiDataTableClass}>
              <thead>
                <tr>
                  <th className="text-left">{text("Name")}</th>
                  <th className="text-left">{text("Size")}</th>
                  <th className="text-left">{text("Last modified")}</th>
                  <th className="text-left">{text("Storage class")}</th>
                </tr>
              </thead>
              <tbody className={tableDividerClass}>
                {loading && (
                  <tr>
                    <td colSpan={4} className="ui-table-secondary">
                      {text("Loading objects...")}
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ui-table-secondary">
                      {text("No objects in this prefix.")}
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => {
                    if (row.type === "prefix") {
                      return (
                        <tr
                          key={row.key}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          onClick={() => openPrefix(row.key)}
                        >
                          <td className="ui-table-primary">📁 {row.name}</td>
                          <td className="ui-table-secondary">—</td>
                          <td className="ui-table-secondary">—</td>
                          <td className="ui-table-secondary">—</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="ui-table-primary">{row.name}</td>
                        <td className="ui-table-secondary">{formatBytes(row.object.size)}</td>
                        <td className="ui-table-secondary">
                          {row.object.last_modified
                            ? new Date(row.object.last_modified).toLocaleString(intlLocale)
                            : "-"}
                        </td>
                        <td className="ui-table-secondary">{row.object.storage_class ?? "-"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
