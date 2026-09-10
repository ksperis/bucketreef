/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import { cx } from "./ui/styles";
import "./modal.css";

/** Shared layout for native action buttons or labelled choices inside a dialog. */
export default function ModalOptions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("modal-options", className)}>{children}</div>;
}
