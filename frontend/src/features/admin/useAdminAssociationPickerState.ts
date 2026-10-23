/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useState } from "react";

export default function useAdminAssociationPickerState() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<number[]>([]);

  const reset = useCallback(() => {
    setSearch("");
    setOpen(false);
    setSelections([]);
  }, []);

  const toggleSelection = useCallback((id: number) => {
    setSelections((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  }, []);

  return {
    search,
    setSearch,
    open,
    setOpen,
    selections,
    setSelections,
    reset,
    toggleSelection,
  };
}
