/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import ConfirmActionDialog from "../ConfirmActionDialog";
import { useContext, useEffect } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import { readStoredUser } from "../../utils/workspaces";

type Props = {
  dirty: boolean;
  onDiscard?: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  closeLabel?: string;
  discardDisabled?: boolean;
};

function RouteGuard({
  dirty,
  onDiscard,
  title = "Discard changes?",
  description = "Your changes have not been saved.",
  confirmLabel = "Discard changes",
  cancelLabel = "Keep editing",
  closeLabel,
  discardDisabled = false,
}: Props) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      Boolean(readStoredUser()) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  if (blocker.state !== "blocked") return null;
  return (
    <ConfirmActionDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      closeLabel={closeLabel}
      confirmDisabled={discardDisabled}
      zIndexClass="z-[110]"
      onCancel={() => blocker.reset()}
      onConfirm={() => {
        if (discardDisabled) return;
        onDiscard?.();
        blocker.proceed();
      }}
    />
  );
}

export default function SettingsNavigationGuard(props: Props) {
  const hasDataRouter = Boolean(useContext(UNSAFE_DataRouterContext));
  useEffect(() => {
    if (!props.dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [props.dirty]);
  // An idle page guard must not compete with an edited dialog's route blocker.
  return hasDataRouter && props.dirty ? <RouteGuard {...props} /> : null;
}
