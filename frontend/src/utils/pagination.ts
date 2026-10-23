/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type PaginatedItemsResponse<T> = {
  items: T[];
  has_next: boolean;
};

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

export function slicePage<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.max(1, pageSize);
  const start = (normalizedPage - 1) * normalizedPageSize;
  return items.slice(start, start + normalizedPageSize);
}

export async function collectPaginatedItems<T>(
  loadPage: (page: number) => Promise<PaginatedItemsResponse<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const response = await loadPage(page);
    items.push(...response.items);
    if (!response.has_next) return items;
    page += 1;
  }
}
