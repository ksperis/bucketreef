/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef } from "react";

import UiIconButton from "../../components/ui/UiIconButton";
import { ChevronDownIcon } from "../browser/browserIcons";

export type DetailsDrawerNavigationState = {
  previous?: () => void;
  next?: () => void;
  position?: string;
  focus?: "previous" | "next";
  returnFocus?: () => HTMLElement | null;
};

export function guardDetailsDrawerNavigation(
  navigation: DetailsDrawerNavigationState | undefined,
  requestTransition: (action: () => void) => void,
): DetailsDrawerNavigationState | undefined {
  if (!navigation) return undefined;
  const previous = navigation.previous;
  const next = navigation.next;
  return {
    ...navigation,
    previous: previous ? () => requestTransition(previous) : undefined,
    next: next ? () => requestTransition(next) : undefined,
  };
}

type DetailsDrawerNavigationProps = {
  navigation?: DetailsDrawerNavigationState;
  labels: {
    group: string;
    previous: string;
    next: string;
  };
};

export default function DetailsDrawerNavigation({
  navigation,
  labels,
}: DetailsDrawerNavigationProps) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const requestedFocus = navigation?.focus;

  useEffect(() => {
    if (!requestedFocus) return;
    const preferred =
      requestedFocus === "next" ? nextRef.current : previousRef.current;
    const alternative =
      requestedFocus === "next" ? previousRef.current : nextRef.current;
    const target =
      preferred && !preferred.disabled
        ? preferred
        : alternative && !alternative.disabled
          ? alternative
          : navigationRef.current;
    target?.focus({ preventScroll: true });
  }, [navigation?.position, requestedFocus]);

  if (!navigation || (!navigation.position && !navigation.previous && !navigation.next)) {
    return null;
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1"
      ref={navigationRef}
      tabIndex={-1}
      role="group"
      aria-label={labels.group}
    >
      <UiIconButton
        ref={previousRef}
        variant="ghost"
        className="max-lg:h-11 max-lg:w-11"
        label={labels.previous}
        icon={<ChevronDownIcon className="h-4 w-4 rotate-90" />}
        disabled={!navigation.previous}
        onClick={navigation.previous}
      />
      {navigation.position ? (
        <span className="ui-caption whitespace-nowrap tabular-nums text-[var(--ui-text-muted)]">
          {navigation.position}
        </span>
      ) : null}
      <UiIconButton
        ref={nextRef}
        variant="ghost"
        className="max-lg:h-11 max-lg:w-11"
        label={labels.next}
        icon={<ChevronDownIcon className="h-4 w-4 -rotate-90" />}
        disabled={!navigation.next}
        onClick={navigation.next}
      />
    </div>
  );
}
