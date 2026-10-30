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
