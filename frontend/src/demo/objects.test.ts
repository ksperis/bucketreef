/* Copyright (c) 2026 Laurent Barbe. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from "vitest";
import { objectListing, objects } from "./objects";
import { createSeed, newBucket, putObject } from "./state";
import { currentUser, type DemoRequest } from "./http";

function fixture() {
  const state = createSeed();
  const account = state.accounts[0];
  const bucket = newBucket("browser-fixture", account);
  state.buckets = [bucket];
  const request = (body: Record<string, unknown>, action = "copy"): DemoRequest => ({ state, body, method: "POST", path: `/browser/buckets/${bucket.name}/${action}`, url: new URL(`https://demo.test/?account_id=${account.id}`), request: new Request("https://demo.test"), persona: "admin", user: currentUser(state, "admin") });
  return { state, bucket, request };
}

describe("demo Browser evolutions", () => {
  it("preserves exact keys, current-only moves", async () => {
    const { bucket, request } = fixture();
    putObject(bucket, " étude//x.txt ", new Blob(["older"]), false);
    const source = putObject(bucket, " étude//x.txt ", new Blob(["current"]), false);
    const older = source.versions[1].version_id;
    const payload = { source_bucket: bucket.name, source_key: source.key, destination_key: " étude//y.txt ", move: true };
    const result = await objects(request(payload));
    expect(await result!.json()).toMatchObject({ message: "ok" });
    expect(source.versions[0].deleted).toBe(true);
    expect(source.versions.some(version => version.version_id === older)).toBe(true);
    expect(bucket.objects.find(object => object.key === payload.destination_key)?.versions[0].size).toBe(7);
  });
  it("pages combined listings and includes empty markers only for operation manifests", () => {
    const { bucket } = fixture();
    for (const key of ["docs/", "docs/empty/", "docs/a.csv", "docs/b.txt"]) putObject(bucket, key, new Blob(key.endsWith("/") ? [] : ["data"]), false);
    const list = (query: string) => objectListing(bucket, new URL(`https://demo.test/?prefix=docs%2F&${query}`));
    const normal = list("recursive=true&item_type=file");
    expect(normal.objects.map(object => object.key)).toEqual(["docs/a.csv", "docs/b.txt"]);
    expect(list("recursive=true&include_folder_markers=true&item_type=file").objects).toHaveLength(4);
    const first = list("max_keys=1");
    expect(first.prefixes).toEqual(["docs/empty/"]); expect(first.objects).toEqual([]);
    expect(list(`max_keys=1&continuation_token=${first.next_continuation_token}`).objects[0].key).toBe("docs/a.csv");
  });
});
