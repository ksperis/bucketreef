/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthCard, AuthCenteredPage } from "./AuthSurface";

describe("AuthSurface", () => {
  it("renders the shared centered auth surface and optional radial brand layer", () => {
    const { container } = render(
      <AuthCenteredPage radial className="py-10">
        <AuthCard className="max-w-md p-8">Authentication content</AuthCard>
      </AuthCenteredPage>,
    );

    expect(screen.getByText("Authentication content")).toHaveClass("max-w-md", "rounded-3xl", "bg-white/95");
    expect(container.querySelector(".auth-brand-glow-coral")).toBeInTheDocument();
    expect(container.querySelector(".auth-brand-radial")).toBeInTheDocument();
  });
});
