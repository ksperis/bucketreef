import { describe, expect, it } from "vitest";
import { buckets } from "./buckets";
import { governance } from "./governance";
import { currentUser, type DemoRequest } from "./http";
import { readModels } from "./readModels";
import { createSeed, type Persona } from "./state";

function request(
  state: ReturnType<typeof createSeed>,
  persona: Persona,
  path: string,
): DemoRequest {
  const url = new URL(`https://demo.test/api${path}`);
  return {
    state,
    url,
    path: url.pathname.slice(4),
    method: "GET",
    body: {},
    request: new Request(url),
    persona,
    user: currentUser(state, persona),
  };
}

describe("demo browser-only persona", () => {
  it("exposes only Browser through the owned private connection", async () => {
    const state = createSeed();
    const user = currentUser(state, "browser-user");
    expect(user.id).toBe(6);
    expect(user.account_links).toEqual([]);

    const workspaceResponse = readModels(request(state, "browser-user", "/me/workspace-access"));
    expect(workspaceResponse).toBeDefined();
    const workspace = await workspaceResponse!.json();
    expect(workspace).toMatchObject({
      manager: { available: false, context_count: 0 },
      portal: { available: false, context_count: 0 },
      browser: { available: true, context_count: 1 },
      default_workspace: "browser",
    });

    const contextsResponse = readModels(request(state, "browser-user", "/me/execution-contexts?workspace=browser"));
    expect(contextsResponse).toBeDefined();
    expect(await contextsResponse!.json()).toEqual([
      expect.objectContaining({
        kind: "connection",
        id: "conn-303",
        display_name: "Helios S3 access",
        connection_scope: "private",
        manager_role: null,
        portal_role: null,
      }),
    ]);

    const bucketsResponse = buckets(request(state, "browser-user", "/browser/buckets?context_id=conn-303"));
    expect(bucketsResponse).toBeDefined();
    const bucketList = await bucketsResponse!.json();
    expect(bucketList.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "helios-documents" }),
    ]));
  });

  it("keeps the private Browser connection out of the Admin inventory", async () => {
    const state = createSeed();
    const adminResponse = governance(request(state, "admin", "/admin/s3-connections"));
    expect(adminResponse).toBeDefined();
    const adminConnections = await adminResponse!.json();
    expect(adminConnections.items.map((connection: { id: number }) => connection.id)).toEqual([301, 302]);

    const privateResponse = governance(request(state, "browser-user", "/connections"));
    expect(privateResponse).toBeDefined();
    const privateConnections = await privateResponse!.json();
    expect(privateConnections.map((connection: { id: number }) => connection.id)).toEqual([303]);
    expect(privateConnections[0]).not.toHaveProperty("demo_backing_account_id");
  });
});
