import { useBrowserText } from "./browserMessages";
/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useMemo, useState } from "react";
import ToolbarSearchInput from "../../components/ToolbarSearchInput";
import StorageSpaceIcon from "../../components/StorageSpaceIcon";
import UiIconButton from "../../components/ui/UiIconButton";
import type { BrowserFavorite, BrowserFavoriteInput } from "../../api/browserFavorites";
import type { BrowserBucket } from "../../api/browserContracts";
import BrowserUtilityIcon from "./BrowserUtilityIcon";
import { BucketIcon, SearchIcon } from "./browserIcons";

export default function BrowserFavoritesControl({
  current,
  accountUser,
  favorites,
  onApply,
  onRemove,
  busy,
  error,
  unavailable,
  contextLabels = {},
  bucketLabels,
  bucketDetailsByName,
  compact = false,
}: {
  current: BrowserFavoriteInput;
  accountUser: boolean;
  favorites: BrowserFavorite[];
  onApply: (favorite: BrowserFavorite) => void;
  onRemove: (favorite: BrowserFavorite) => void;
  busy: boolean;
  error: string;
  unavailable: Record<string, string>;
  contextLabels?: Record<string, string>;
  bucketLabels?: ReadonlyMap<string, string>;
  bucketDetailsByName?: ReadonlyMap<string, BrowserBucket>;
  compact?: boolean;
}) {
  const tr = useBrowserText();
  const [search, setSearch] = useState("");
  const filteredFavorites = useMemo(
    () =>
      favorites.filter((favorite) => {
        const bucketLabel =
          favorite.context === current.context
            ? bucketLabels?.get(favorite.bucket) ?? favorite.bucket
            : favorite.bucket;
        const displayName =
          bucketLabel !== favorite.bucket && favorite.name === favorite.bucket
            ? bucketLabel
            : favorite.name;
        return `${displayName} ${favorite.name} ${bucketLabel} ${favorite.bucket} ${favorite.prefix}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase());
      }),
    [bucketLabels, current.context, favorites, search],
  );
  const totalLabel = favorites.length === 1 ? "1 favorite" : `${favorites.length} favorites`;
  const filteredLabel =
    search.trim().length > 0 && filteredFavorites.length !== favorites.length
      ? `${filteredFavorites.length} result${filteredFavorites.length === 1 ? "" : "s"}`
      : totalLabel;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!compact && (
        <div className="shrink-0 border-b border-[color:var(--shell-border-soft)] px-3 py-3">
          <ToolbarSearchInput
            value={search}
            onChange={setSearch}
            placeholder={tr("Search favorites")}
            label={tr("Search favorites")}
            labelClassName="sr-only"
            className="w-full"
            inputClassName="w-full py-2 font-medium"
            leadingControl={<SearchIcon className="h-3.5 w-3.5 text-slate-400" />}
            spellCheck={false}
          />
        </div>
      )}
      {!compact && (
        <div className="flex h-12 shrink-0 items-center border-b border-[color:var(--shell-border-soft)] px-3">
          <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--shell-muted-text)]">
            {filteredLabel}
          </p>
        </div>
      )}
      {!accountUser ? (
        <div className={`min-h-0 flex-1 ${compact ? "px-2 py-2" : "px-2.5 py-3"}`}>
          <p className="ui-caption px-2">
            {tr(
              "Synchronization requires a UI account. Temporary S3 sessions cannot save favorites to an account.",
            )}
          </p>
        </div>
      ) : (
        <>
          <div
            role="region"
            aria-label={tr("Favorites")}
            className={`shell-sidebar-scroll min-h-0 flex-1 overflow-y-auto ${compact ? "px-2 py-2" : "px-2.5 py-3"}`}
          >
            <div className="space-y-1.5">
              {filteredFavorites.map((favorite) => {
                const bucketLabel =
                  favorite.context === current.context
                    ? bucketLabels?.get(favorite.bucket) ?? favorite.bucket
                    : favorite.bucket;
                const displayName =
                  bucketLabel !== favorite.bucket && favorite.name === favorite.bucket
                    ? bucketLabel
                    : favorite.name;
                const subtitle = `${bucketLabel}${
                  favorite.prefix ? ` / ${favorite.prefix}` : ""
                }${
                  contextLabels[favorite.context]
                    ? ` · ${contextLabels[favorite.context]}`
                    : favorite.context !== current.context
                      ? ` · ${favorite.context}`
                      : ""
                }`;
                const selected =
                  favorite.context === current.context &&
                  favorite.bucket === current.bucket &&
                  favorite.prefix === current.prefix;
                const bucketDetails =
                  favorite.context === current.context
                    ? bucketDetailsByName?.get(favorite.bucket)
                    : undefined;
                return (
                  <div key={favorite.id}>
                    <div
                      className={
                        compact
                          ? `rounded-md ${
                              selected ? "shell-sidebar-item-active" : "shell-sidebar-item"
                            }`
                          : `relative flex w-full min-w-0 items-center rounded-md transition ${
                              selected
                                ? "shell-sidebar-item-active before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary"
                                : "shell-sidebar-item"
                            }`
                      }
                    >
                      {compact ? (
                        <button
                          type="button"
                          disabled={busy}
                          title={`${displayName} · ${subtitle}`}
                          onClick={() => onApply(favorite)}
                          className="flex min-w-0 flex-1 items-center justify-center rounded-md px-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <BrowserUtilityIcon
                            filled
                            className="h-4 w-4 text-yellow-400 dark:text-yellow-300"
                          />
                          <span className="sr-only">{displayName}</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            title={`${displayName} · ${subtitle}`}
                            onClick={() => onApply(favorite)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium leading-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            {bucketDetails ? (
                              <StorageSpaceIcon
                                icon={bucketDetails.icon}
                                name={bucketLabel}
                                size="sidebar"
                                decorative
                              />
                            ) : (
                              <BucketIcon className="h-4 w-4 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{displayName}</span>
                              <span
                                className="block truncate text-[11px] font-medium text-[var(--shell-muted-text)]"
                                title={subtitle}
                              >
                                {subtitle}
                              </span>
                            </span>
                          </button>
                          <UiIconButton
                            size="compact"
                            disabled={busy}
                            aria-pressed="true"
                            label={`${tr("Remove from favorites")}: ${displayName}`}
                            onClick={() => onRemove(favorite)}
                            className="mr-1 shrink-0"
                            icon={
                              <BrowserUtilityIcon
                                filled
                                className="h-4 w-4 text-yellow-400 dark:text-yellow-300"
                              />
                            }
                          />
                        </>
                      )}
                    </div>
                    {unavailable[favorite.id] && (
                      <p role="status" className="px-2 pb-2 ui-caption">
                        {unavailable[favorite.id]}
                      </p>
                    )}
                  </div>
                );
              })}
            {filteredFavorites.length === 0 && (
              <p className="px-2 py-2 ui-caption text-[var(--shell-muted-text)]">
                {favorites.length === 0
                  ? tr("No saved items in this workspace.")
                  : "No matching favorite."}
              </p>
            )}
            </div>
          </div>
          {error && (
            <div className="shrink-0 px-3 pb-3">
              <p role="alert" className="ui-caption">
                {error}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
