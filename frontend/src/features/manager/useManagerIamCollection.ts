/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";
import type { S3ExecutionContextSelector } from "../../api/accountParams";
import { extractApiError } from "../../utils/apiError";

type ListManagerIamItems<Item> = (contextId: S3ExecutionContextSelector) => Promise<Item[]>;

export function useManagerIamCollection<Item>(listItems: ListManagerIamItems<Item>) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (contextId: S3ExecutionContextSelector) => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listItems(contextId));
    } catch (loadError) {
      setError(extractApiError(loadError, "Unexpected error"));
    } finally {
      setLoading(false);
    }
  }, [listItems]);

  const loadRelated = useCallback(async <RelatedItem>(
    contextId: S3ExecutionContextSelector,
    listRelatedItems: ListManagerIamItems<RelatedItem>,
    setRelatedItems: (items: RelatedItem[]) => void,
  ) => {
    try {
      setRelatedItems(await listRelatedItems(contextId));
    } catch (loadError) {
      setError(extractApiError(loadError, "Unexpected error"));
    }
  }, []);

  return { error, items, load, loadRelated, loading, setError, setItems, setLoading };
}
