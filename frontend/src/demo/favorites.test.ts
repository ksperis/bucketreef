import { describe, expect, it } from "vitest";
import { favorites } from "./favorites";
import { createSeed } from "./state";
import { currentUser, type DemoRequest } from "./http";

function fixture() {
  const state = createSeed();
  const request = (method: string, body: Record<string, unknown> = {}, suffix = "", persona: DemoRequest["persona"] = "admin"): DemoRequest => ({
    state, method, body, path: "/users/me/browser-favorites" + suffix.split("?")[0],
    url: new URL("https://demo.test/api/users/me/browser-favorites" + suffix),
    request: new Request("https://demo.test"), persona, user: currentUser(state, persona),
  });
  const payload = { name: "Exact path", surface: "browser", workspace: "browser", context: "conn-1", bucket: "demo", prefix: " /été// " };
  return { request, payload };
}

describe("demo path favorites", () => {
  it("keeps exact paths personal and separated by surface", async () => {
    const { request, payload } = fixture();
    const saved = await favorites(request("POST", payload))!.json();
    expect(saved.prefix).toBe(payload.prefix);
    expect(await favorites(request("GET", {}, "", "member"))!.json()).toEqual([]);
    expect(await favorites(request("GET", {}, "?surface=portal"))!.json()).toEqual([]);
    expect(await favorites(request("GET"))!.json()).toHaveLength(1);
    expect(saved).not.toHaveProperty("kind");
    expect(saved).not.toHaveProperty("view");
  });
  it("renames and removes with optimistic revisions", async () => {
    const { request, payload } = fixture();
    const saved = await favorites(request("POST", payload))!.json();
    const path = `/${saved.id}`;
    const updated = await favorites(request("PUT", { ...payload, name: "Renamed" }, path + "?revision=1"))!.json();
    expect(updated.revision).toBe(2);
    expect(() => favorites(request("DELETE", {}, path + "?revision=1"))).toThrow(/changed/);
    favorites(request("DELETE", {}, path + "?revision=2"));
    expect(await favorites(request("GET"))!.json()).toEqual([]);
  });
  it("rejects retired fields and the old endpoint", () => {
    const { request, payload } = fixture();
    expect(() => favorites(request("POST", { ...payload, view: {} }))).toThrow(/Unknown favorite field/);
    expect(favorites({ ...request("GET"), path: "/users/me/browser-presets" })).toBeUndefined();
  });
});
