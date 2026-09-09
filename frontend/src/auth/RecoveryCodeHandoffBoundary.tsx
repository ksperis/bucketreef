/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { recoveryCodeHandoff } from "./recoveryCodeHandoff";
import { useSession } from "./SessionProvider";
import { useProfileI18n } from "../features/shared/profileMessages";
import { ProfileButton } from "../features/shared/ProfileControls";
import UiInlineMessage from "../components/ui/UiInlineMessage";

export default function RecoveryCodeHandoffBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(recoveryCodeHandoff.subscribe, recoveryCodeHandoff.getSnapshot);
  const { clear } = useSession();
  const { text: currentText, locale } = useProfileI18n();
  const handoffLocale = useRef(locale);
  const handoffText = useRef(currentText);
  if (state.phase === "idle") { handoffText.current = currentText; handoffLocale.current = locale; }
  const text = handoffText.current;
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (state.phase !== "ready") return;
    clear();
    heading.current?.focus();
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const forget = () => recoveryCodeHandoff.reset();
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", forget);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", forget);
    };
  }, [clear, state.phase]);
  if (state.phase !== "ready") return children;
  const copy = async (index: number) => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(state.codes[index]);
      setCopied(index);
    } catch { setCopyError(true); }
  };
  return (
    <main lang={handoffLocale.current} className="min-h-screen bg-[var(--ui-surface)] px-4 py-8 text-[var(--ui-text)] sm:px-8">
      <div className="max-w-2xl space-y-5">
        <h1 className="text-xl font-semibold" tabIndex={-1} ref={heading}>{text("codes")}</h1>
        <p className="text-sm">{text("codesOnce")}</p>
        <p className="text-sm text-[var(--ui-text-muted)]">{text("signedOut")}</p>
        <ol className="grid gap-2 sm:grid-cols-2">
          {state.codes.map((code, index) => <li key={index} className="flex items-center justify-between gap-3 rounded-md border border-[var(--ui-border)] p-3">
            <code className="break-all text-sm select-all">{code}</code>
            <ProfileButton variant="secondary" onClick={() => void copy(index)} aria-label={`${text("copy")} ${index + 1}`}>{copied === index ? text("copied") : text("copy")}</ProfileButton>
          </li>)}
        </ol>
        {copyError && <UiInlineMessage tone="error" role="alert">{text("copyFailed")}</UiInlineMessage>}
        <ProfileButton onClick={() => { recoveryCodeHandoff.reset(); window.location.replace("/login"); }}>{text("codesSaved")}</ProfileButton>
      </div>
    </main>
  );
}
