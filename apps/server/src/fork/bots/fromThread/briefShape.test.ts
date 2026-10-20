import { describe, expect, it } from "@effect/vitest";
import { briefShape, shapeKey } from "./briefShape.ts";

describe("briefShape", () => {
  it("ignores files, pull requests, numbers and quoted values", () => {
    const a = briefShape('Resolve conflicts in src/a.ts for PR #12, keep "ours", run 3 times.');
    const b = briefShape(
      "Resolve  conflicts in lib/b/c.tsx for PR #9001, keep `theirs`, run 10 times.",
    );
    expect(a).toBe(b);
    expect(shapeKey(a)).toBe(shapeKey(b));
    expect(a).toBe("resolve conflicts in {{file}} for pr #{{pr}}, keep {{text}}, run {{n}} times.");
  });

  it("tells different jobs apart", () => {
    expect(briefShape("Review src/a.ts")).not.toBe(briefShape("Delete src/a.ts"));
  });

  it("is at most 400 characters", () => {
    expect(briefShape("word ".repeat(500)).length).toBe(400);
  });
});
