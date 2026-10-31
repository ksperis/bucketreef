/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { roundedClampedPercentageOf } from "../../utils/numbers";

export type ActionProgressState = {
  label: string;
  completed: number;
  total: number;
  failed: number;
};

export const calculateActionProgressPercent = (
  progress: Pick<ActionProgressState, "completed" | "total"> | null | undefined
) => {
  if (!progress) return 0;
  return roundedClampedPercentageOf(progress.completed, progress.total) ?? 0;
};
