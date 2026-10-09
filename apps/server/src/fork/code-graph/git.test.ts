import { describe, expect, it } from "@effect/vitest";

import { parsePorcelainPaths } from "./git.ts";

describe("parsePorcelainPaths", () => {
  it("lists changed and untracked files and the new path of a rename", () => {
    const output = [
      " M src/a.ts",
      "A  src/b.ts",
      " D src/c.ts",
      "R  src/new.ts",
      "src/old.ts",
      "?? notes/todo.md",
      "",
    ].join("\0");
    expect(parsePorcelainPaths(output)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/new.ts",
      "notes/todo.md",
    ]);
  });

  it("keeps spaces in paths and reads a clean tree as no files", () => {
    expect(parsePorcelainPaths(" M docs/read me.md\0")).toEqual(["docs/read me.md"]);
    expect(parsePorcelainPaths("")).toEqual([]);
  });
});
