/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import type { ReactNode } from "react";
import "./modal.css";

/** Place inside the owning form to retain native submit and validation behavior. */
export default function ModalActions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}
