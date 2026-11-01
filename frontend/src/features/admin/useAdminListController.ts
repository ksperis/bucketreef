/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import useAdminResourceController from "./useAdminResourceController";

type Args<T> = {
  loadItems: () => Promise<T[]>;
  formatError: (error: unknown) => string;
};

export default function useAdminListController<T>({
  loadItems,
  formatError,
}: Args<T>) {
  const {
    resource: items,
    setResource: setItems,
    ...controller
  } = useAdminResourceController<T[]>({
    loadResource: loadItems,
    initialResource: [],
    formatError,
  });

  return {
    items,
    setItems,
    ...controller,
  };
}
