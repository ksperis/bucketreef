/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import type { RefObject } from "react";
import { ListActionButton } from "../../components/list/ListControls";
import AnchoredPortalMenu from "../../components/ui/AnchoredPortalMenu";
import { cx, uiCardMutedClass, uiMenuClass } from "../../components/ui/styles";
import { InfoIcon } from "./browserIcons";
import { useBrowserI18n } from "./browserI18n";

type BrowserNoticesPanelProps = {
  bucketError: string | null;
  statusMessage: string | null;
  corsInformation: string | null;
  warnings: string[];
  hasCorsAction: boolean;
  corsActionTriggerRef: RefObject<HTMLButtonElement>;
  corsActionPopoverRef: RefObject<HTMLDivElement>;
  showCorsActionPopover: boolean;
  toggleCorsActionPopover: () => void;
  uiOrigin?: string;
  corsFixing: boolean;
  onEnsureCors: () => void;
};

const noticeSurfaceClasses = cx(uiCardMutedClass, "shadow-none");
const floatingMenuClasses = cx(uiMenuClass, "overflow-hidden p-1.5");

export default function BrowserNoticesPanel({
  bucketError,
  statusMessage,
  corsInformation,
  warnings,
  hasCorsAction,
  corsActionTriggerRef,
  corsActionPopoverRef,
  showCorsActionPopover,
  toggleCorsActionPopover,
  uiOrigin,
  corsFixing,
  onEnsureCors,
}: BrowserNoticesPanelProps) {
  const { text } = useBrowserI18n();

  if (!bucketError && !statusMessage && !corsInformation && warnings.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 pb-2">
      <div
        className={`${noticeSurfaceClasses} px-3 py-2.5 ui-caption text-slate-600 dark:text-slate-300`}
      >
        {bucketError && (
          <p className="font-semibold text-rose-600 dark:text-rose-200">
            {text(bucketError)}
          </p>
        )}
        {statusMessage && (
          <p className="text-slate-500 dark:text-slate-400">{statusMessage}</p>
        )}
        {corsInformation && (
          <p className="font-medium text-sky-700 dark:text-sky-200">
            {hasCorsAction ? (
              <span className="inline-flex items-center gap-1">
                <span>{corsInformation}</span>
                <button
                  ref={corsActionTriggerRef}
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-sky-700 transition hover:text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 dark:text-sky-200 dark:hover:text-sky-100 dark:focus-visible:outline-sky-200"
                  onClick={toggleCorsActionPopover}
                  aria-label={text("CORS actions")}
                  title={text("CORS actions")}
                  aria-haspopup="dialog"
                  aria-expanded={showCorsActionPopover}
                >
                  <InfoIcon className="h-3.5 w-3.5" />
                </button>
                <AnchoredPortalMenu
                  open={showCorsActionPopover}
                  anchorRef={corsActionTriggerRef}
                  placement="bottom-start"
                  offset={6}
                  minWidth={288}
                  className={`w-80 ${floatingMenuClasses}`}
                >
                  <div ref={corsActionPopoverRef}>
                    <p className="ui-caption text-slate-600 dark:text-slate-300">
                      {text(
                        "Allow direct access from {origin} by adding CORS rules to this bucket.",
                        { origin: uiOrigin ?? "" },
                      )}
                    </p>
                    <ListActionButton
                      type="button"
                      variant="success"
                      className="mt-2"
                      onClick={onEnsureCors}
                      disabled={corsFixing}
                      title={text("Add {origin} to bucket CORS rules.", {
                        origin: uiOrigin ?? "",
                      })}
                      aria-label={text("Add {origin} to CORS", {
                        origin: uiOrigin ?? "",
                      })}
                    >
                      {corsFixing
                        ? text("Adding...")
                        : text("Add {origin} to CORS", {
                            origin: uiOrigin ?? "",
                          })}
                    </ListActionButton>
                  </div>
                </AnchoredPortalMenu>
              </span>
            ) : (
              corsInformation
            )}
          </p>
        )}
        {warnings.map((warning, index) => (
          <p
            key={`${warning}-${index}`}
            className="font-semibold text-amber-600 dark:text-amber-200"
          >
            {warning}
          </p>
        ))}
      </div>
    </div>
  );
}
