/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthButton, AuthInput, AuthSelect } from "./AuthFormControls";

describe("AuthFormControls", () => {
  it("keeps auth labels associated with shared form controls", () => {
    render(
      <>
        <AuthInput label="Email" type="email" />
        <AuthSelect label="Directory" defaultValue="corp">
          <option value="corp">Corporate</option>
        </AuthSelect>
      </>,
    );

    expect(screen.getByLabelText("Email")).toHaveClass("ui-control", "rounded-xl", "bg-white/90");
    expect(screen.getByLabelText("Directory")).toHaveClass("ui-control", "rounded-xl", "bg-white/90");
  });

  it("uses the shared button primitive for primary and provider actions", () => {
    render(
      <>
        <AuthButton>Sign in</AuthButton>
        <AuthButton presentation="provider">Continue with SSO</AuthButton>
      </>,
    );

    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("ui-button-base", "ui-button-primary");
    expect(screen.getByRole("button", { name: "Continue with SSO" })).toHaveClass("ui-button-base", "ui-button-secondary");
  });
});
