/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const MAX_VISIBLE_ASSOCIATION_OPTIONS = 10;

type AssociationOptionsConfig<T> = {
  items: T[];
  selectedIds: ReadonlySet<number>;
  search: string;
  getId: (item: T) => number;
  getLabel: (item: T) => string;
  include?: (item: T) => boolean;
};

export function filterAdminAssociationOptions<T>({
  items,
  selectedIds,
  search,
  getId,
  getLabel,
  include,
}: AssociationOptionsConfig<T>): T[] {
  const query = search.trim().toLowerCase();
  return items.filter(
    (item) =>
      !selectedIds.has(getId(item)) &&
      (include?.(item) ?? true) &&
      (!query || getLabel(item).toLowerCase().includes(query)),
  );
}

export function deriveAdminAssociationOptions<T>(
  config: AssociationOptionsConfig<T>,
  maxVisibleOptions = MAX_VISIBLE_ASSOCIATION_OPTIONS,
) {
  const available = filterAdminAssociationOptions(config);
  return {
    available,
    visible: available.slice(0, maxVisibleOptions),
  };
}
