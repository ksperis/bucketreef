/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";

import { currentUser, type DemoRequest } from "./http";
import { portal } from "./portal";
import { createSeed, type Persona } from "./state";

function request(
  state: ReturnType<typeof createSeed>,
  path: string,
  method: string,
  body: Record<string, unknown> = {},
  persona: Persona = "project-manager",
): DemoRequest {
  const url = new URL(`https://demo.test${path}?account_id=${state.accounts[0].id}`);
  return {
    state,
    url,
    path,
    method,
    body,
    request: new Request(url),
    persona,
    user: currentUser(state, persona),
  };
}

describe("demo Portal request contract", () => {
  it.each(["intent", "portal_role"])(
    "rejects collaborator requests without canonical %s",
    (missingField) => {
      const state = createSeed();
      const body: Record<string, unknown> = {
        request_type: "portal_user_access",
        intent: "add",
        target_name: "New member",
        target_email: "new.member@example.test",
        portal_role: "portal_user",
      };
      delete body[missingField];

      expect(() => portal(request(state, "/portal/requests", "POST", body))).toThrow(
        missingField,
      );
    },
  );

  it("rejects noncanonical persisted collaborator requests during approval", () => {
    const state = createSeed();
    const stored = state.requests.find(item => item.request_type === "portal_user_access");
    expect(stored).toBeDefined();
    delete stored!.payload.intent;

    expect(() =>
      portal(request(state, `/admin/portal-requests/${stored!.id}/approve`, "POST", {}, "admin")),
    ).toThrow("intent");
  });

  it("keeps seeded collaborator requests canonical", () => {
    const state = createSeed();
    const collaboratorRequests = state.requests.filter(
      item => item.request_type === "portal_user_access",
    );

    expect(collaboratorRequests.length).toBeGreaterThan(0);
    for (const item of collaboratorRequests) {
      expect(item.payload).toMatchObject({ intent: "add", portal_role: "portal_user" });
    }
  });
});
