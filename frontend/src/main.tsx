/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
// Install the local transport before importing any session, router or branding code.
async function start() {
  if (import.meta.env.MODE === "demo") {
    const { initializeDemo } = await import("./demo/runtime");
    if (!(await initializeDemo())) return;
  }
  await import("./bootstrap");
}
void start();
