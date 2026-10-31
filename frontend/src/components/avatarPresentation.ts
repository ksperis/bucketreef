/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export const avatarSizeClasses: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[9px]",
  sm: "h-7 w-7 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-xl",
};

export function initialsFromLabel(label: string | null | undefined, fallback: string): string {
  const parts = (label ?? "").trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return fallback.toUpperCase();
}
