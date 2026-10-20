import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { VaultHealthOutageTarget, VaultHealthSnapshot } from "./vault-health.ts";

const isTarget = Schema.is(VaultHealthOutageTarget);
const decodeSnapshot = Schema.decodeUnknownSync(VaultHealthSnapshot);
describe("maintenance outage metadata", () => {
  it("accepts snapshots from before outage grouping", () => {
    const legacy = { revision: 1, checkedAt: 1, rules: [], issues: [], omittedIssues: 0 };
    expect(decodeSnapshot(legacy)).toEqual(legacy);
  });
  it("accepts only the fixed GitHub service or an SSH hostname and port", () => {
    expect(isTarget({ kind: "github" })).toBe(true);
    expect(isTarget({ kind: "ssh", hostname: "qa.example", port: 22 })).toBe(true);
    expect(isTarget({ kind: "ssh", hostname: "https://qa.example/path", port: 22 })).toBe(false);
    expect(isTarget({ kind: "ssh", hostname: "user@qa.example", port: 22 })).toBe(false);
    expect(isTarget({ kind: "ssh", hostname: "qa.example", port: 0 })).toBe(false);
    expect(isTarget({ kind: "other-provider" })).toBe(false);
  });
});
