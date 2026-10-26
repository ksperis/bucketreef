/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, useContext, type ReactNode } from "react";

const BucketDetailsScopeContext = createContext(false);

export function BrowserBucketDetailsScope({ children }: { children: ReactNode }) {
  return <BucketDetailsScopeContext.Provider value>{children}</BucketDetailsScopeContext.Provider>;
}

export function useBrowserBucketDetailsScope() {
  return useContext(BucketDetailsScopeContext);
}
