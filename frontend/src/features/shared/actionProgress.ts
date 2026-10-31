/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { clampPercentage } from "../../utils/numbers";

export type ActionProgressState = {
  label: string;
  completed: number;
  total: number;
  failed: number;
};

export const calculateActionProgressPercent = (
  progress: Pick<ActionProgressState, "completed" | "total"> | null | undefined
) => {
  if (!progress || progress.total <= 0) return 0;
  return clampPercentage(Math.round((progress.completed / progress.total) * 100));
};
