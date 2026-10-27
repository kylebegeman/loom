import { describe, expect, it } from "vite-plus/test";
import { pathFieldBrowseStart, pathWithinRoot } from "./pathFieldLogic";

describe("pathWithinRoot", () => {
  it("stores a file inside the project relative to its root", () => {
    expect(pathWithinRoot("/work/app", "/work/app/.env.schema")).toBe(".env.schema");
    expect(pathWithinRoot("/work/app/", "/work/app/config/env.schema")).toBe("config/env.schema");
  });

  it("refuses the root itself, siblings that share its prefix, and outside paths", () => {
    expect(pathWithinRoot("/work/app", "/work/app")).toBeNull();
    expect(pathWithinRoot("/work/app", "/work/app-old/.env.schema")).toBeNull();
    expect(pathWithinRoot("/work/app", "/etc/passwd")).toBeNull();
  });

  it("matches Windows paths without regard to case or separator", () => {
    expect(pathWithinRoot("C:\\Work\\App", "c:\\work\\app\\config\\env.schema")).toBe(
      "config/env.schema",
    );
    expect(pathWithinRoot("C:\\Work\\App", "D:\\Work\\App\\env.schema")).toBeNull();
  });
});

describe("pathFieldBrowseStart", () => {
  it("opens a folder setting on its folder and a file setting on the file's folder", () => {
    expect(pathFieldBrowseStart({ value: "~/Developer", kind: "folder", fallback: "~/" })).toBe(
      "~/Developer",
    );
    expect(pathFieldBrowseStart({ value: "/opt/tools/argent", kind: "file", fallback: "~/" })).toBe(
      "/opt/tools/",
    );
  });

  it("falls back when the value is empty or a command name rather than a path", () => {
    expect(pathFieldBrowseStart({ value: "", kind: "folder", fallback: "~/" })).toBe("~/");
    expect(pathFieldBrowseStart({ value: "codex", kind: "file", fallback: "~/" })).toBe("~/");
  });

  it("resolves a project-relative file against the project root", () => {
    expect(
      pathFieldBrowseStart({
        value: "config/env.schema",
        kind: "file",
        root: "/work/app",
        fallback: "~/",
      }),
    ).toBe("/work/app/config/");
    expect(
      pathFieldBrowseStart({ value: "", kind: "file", root: "C:\\Work\\App", fallback: "~/" }),
    ).toBe("C:\\Work\\App");
    expect(
      pathFieldBrowseStart({
        value: "config/env.schema",
        kind: "file",
        root: "C:\\Work\\App\\",
        fallback: "~/",
      }),
    ).toBe("C:\\Work\\App\\config\\");
  });
});
