import { describe, expect, it } from "vite-plus/test";
import { parseGitHubDeviceCode } from "./githubDeviceCode.ts";

describe("GitHub device code", () => {
  it("reads the documented gh message with terminal colors", () => {
    expect(
      parseGitHubDeviceCode("! First copy your one-time code: \u001b[1mABCD-EFGH\u001b[0m\n"),
    ).toBe("ABCD-EFGH");
  });
  it.each([
    "ABCD-EFGH",
    "token: ABCD-EFGH",
    "First copy your one-time code: ABCD-EFGHI",
    "First copy your one-time code: ABCD-EFGH-1234",
    "First copy your one-time code: ABCD-EFG",
  ])("ignores unrelated or incomplete output: %s", (output) => {
    expect(parseGitHubDeviceCode(output)).toBeNull();
  });
});
