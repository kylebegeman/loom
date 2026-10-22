import { describe, expect, it } from "@effect/vitest";
import { buildVarlockCommandLine, extractVarlockErrors } from "./varlock.ts";
describe("explicit varlock commands", () => {
  it("quotes an entire POSIX command, including shell syntax", () => {
    expect(buildVarlockCommandLine("echo 'a' && cat | sed $VALUE\nnext", "darwin")).toBe(
      "varlock run -- sh -c 'echo '\\''a'\\'' && cat | sed $VALUE\nnext'",
    );
  });
  it("rejects Windows operators and preserves simple commands", () => {
    expect(buildVarlockCommandLine("npm test", "win32")).toBe("varlock run -- npm test");
    for (const command of ["npm test && echo done", "echo %SECRET%", "echo $SECRET", "a\nb"])
      expect(() => buildVarlockCommandLine(command, "win32")).toThrow();
  });
  it("discards config and redacts all resolved values from errors", () => {
    const report = extractVarlockErrors(
      {
        config: {
          SECRET: { value: "secret-fixture" },
          PUBLIC: { value: "public-fixture" },
          COMPLEX: { value: { nested: "nested-fixture" } },
        },
        errors: {
          configItems: { SECRET: "Invalid secret-fixture" },
          root: ["public-fixture and nested-fixture"],
        },
      },
      20,
    );
    expect(report).toEqual({
      ok: false,
      itemErrors: { SECRET: "Invalid [value]" },
      rootErrors: ["[value] and [value]"],
      durationMs: 20,
    });
    expect(JSON.stringify(report)).not.toContain("fixture");
  });
});
