import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { RequireManagerFeatureRulesTool } from "./router";
import { buildEffectiveUserAccess } from "./test/effectiveAccess";
import { setSessionUserCache } from "./utils/workspaces";

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireManagerFeatureRulesTool />}>
          <Route path="/manager/feature-rules" element={<h1>Feature rules page</h1>} />
        </Route>
        <Route path="/unauthorized" element={<h1>This passage is reserved.</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function setStoredUser(featureRules: boolean) {
  setSessionUserCache({
    id: 10,
    email: "manager@example.com",
    role: "ui_user",
    effective_access: buildEffectiveUserAccess({
      manager_tool_access: {
        feature_rules: featureRules,
      },
    }),
  });
}

describe("manager tool routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSessionUserCache(null);
  });

  it("shows restricted access in place without manager tool access", async () => {
    setStoredUser(false);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "This passage is reserved." })).toBeInTheDocument();
  });

  it("allows Feature rules when manager tool access is enabled", async () => {
    setStoredUser(true);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "Feature rules page" })).toBeInTheDocument();
  });

});
