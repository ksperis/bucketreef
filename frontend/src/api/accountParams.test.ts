/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  normalizeS3AccountId,
  normalizeS3ExecutionContextId,
  type S3AccountSelector,
  type S3ExecutionContextSelector,
  withS3AccountParam,
  withS3ContextParam,
} from "./accountParams";

describe("account parameter helpers", () => {
  it("keeps account and execution context selector domains distinct", () => {
    expectTypeOf<S3AccountSelector>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<S3ExecutionContextSelector>().toEqualTypeOf<string | null | undefined>();
  });

  it("emits only positive numeric account identifiers", () => {
    expect(withS3AccountParam({ include_archived: true }, 42)).toEqual({
      include_archived: true,
      account_id: 42,
    });
    expect(withS3AccountParam({ include_archived: true }, 0)).toEqual({
      include_archived: true,
    });
    expect(withS3AccountParam(undefined, -1)).toBeUndefined();
    expect(normalizeS3AccountId(42)).toBe("42");
    expect(normalizeS3AccountId(0)).toBeNull();
  });

  it("emits only non-blank execution context identifiers", () => {
    expect(withS3ContextParam({ feature: "versioning" }, "conn-7")).toEqual({
      feature: "versioning",
      context_id: "conn-7",
    });
    expect(withS3ContextParam({ feature: "versioning" }, "   ")).toEqual({
      feature: "versioning",
    });
    expect(withS3ContextParam(undefined, "")).toBeUndefined();
    expect(normalizeS3ExecutionContextId("s3u-9")).toBe("s3u-9");
    expect(normalizeS3ExecutionContextId("   ")).toBeNull();
  });
});
