import { describe, expect, it } from "@effect/vitest";

import { exactFileId } from "./fileIdentity.ts";

describe("exactFileId", () => {
  it("keeps identities that a stored JSON number represents exactly", () => {
    expect(exactFileId(0n)).toBe(0);
    expect(exactFileId(16777234n)).toBe(16777234);
    expect(exactFileId(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("refuses identities that would round, so ownership stays unproven", () => {
    expect(exactFileId(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBeNull();
    expect(exactFileId(18446744073709551615n)).toBeNull();
    expect(exactFileId(-1n)).toBeNull();
  });
});
