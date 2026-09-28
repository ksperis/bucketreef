/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { createContext } from "react";

// A status rendered inside an authorized workspace must not add another main,
// header or navigation shell. Errors above that shell use a standalone page.
export const WorkspaceErrorContext = createContext<string | null>(null);
