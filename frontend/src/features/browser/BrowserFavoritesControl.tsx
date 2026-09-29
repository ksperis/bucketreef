import { useBrowserText } from "./browserMessages";
/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { useMemo, useState } from "react";
import UiIconButton from "../../components/ui/UiIconButton";
import UiInput from "../../components/ui/UiInput";
import type { BrowserFavorite, BrowserFavoriteInput } from "../../api/browserFavorites";
import BrowserUtilityIcon from "./BrowserUtilityIcon";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 py-3">
      {!compact && (
        <UiInput
          label={tr("Search favorites")}
          labelClassName="sr-only"
          placeholder={tr("Search favorites")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          size="compact"
        />
      )}
      {!accountUser ? (
        <p className="ui-caption px-2">
          {tr(
            "Synchronization requires a UI account. Temporary S3 sessions cannot save favorites to an account.",
          )}
        </p>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
            <section aria-label={tr("Locations")}>
              <h3
                className={
                  compact
                    ? "sr-only"
                    : "px-2 py-2 text-[11px] uppercase tracking-wide text-[var(--shell-muted-text)]"
                }
              >
                {tr("Locations")}
              </h3>
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
                return (
                  <div
                    key={favorite.id}
                    className={`group rounded-md ${
                      selected ? "shell-sidebar-item-active" : "shell-sidebar-item"
                    }`}
                  >
                    <div className="flex items-center">
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
                          <UiIconButton
                            size="compact"
                            disabled={busy}
                            aria-pressed="true"
                            label={`${tr("Remove from favorites")}: ${displayName}`}
                            onClick={() => onRemove(favorite)}
                            className="ml-1 shrink-0"
                            icon={
                              <BrowserUtilityIcon
                                filled
                                className="h-4 w-4 text-yellow-400 dark:text-yellow-300"
                              />
                            }
                          />
                          <button
                            type="button"
                            disabled={busy}
                            title={`${displayName} · ${subtitle}`}
                            onClick={() => onApply(favorite)}
                            className="flex min-w-0 flex-1 items-start rounded-md px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">
                                {displayName}
                              </span>
                              <span
                                className="mt-0.5 block truncate text-[11px] text-[var(--shell-muted-text)]"
                                title={subtitle}
                              >
                                {subtitle}
                              </span>
                            </span>
                          </button>
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
            </section>
            {!favorites.length && (
              <p className="px-2 ui-caption">{tr("No saved items in this workspace.")}</p>
            )}
          </div>
          {error && (
            <p role="alert" className="ui-caption">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
