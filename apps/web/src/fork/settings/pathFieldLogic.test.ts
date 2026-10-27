import { FilesystemBrowseError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  isFolderReadFailure,
  pathFieldBrowseStart,
  pathPickerEntries,
  pathPickerNewFolder,
  pathPickerParentProbe,
  pathWithinRoot,
} from "./pathFieldLogic";

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

const entry = (name: string, kind: "directory" | "file" = "directory") => ({
  name,
  fullPath: `/home/me/${name}`,
  kind,
});
const listing = (parentPath: string, ...entries: ReturnType<typeof entry>[]) => ({
  parentPath,
  entries,
});

describe("pathPickerEntries", () => {
  const listed = [
    entry(".codex"),
    entry("Developer"),
    entry(".env.schema", "file"),
    entry("notes"),
  ];

  it("lists dot entries after the others when hidden entries are shown", () => {
    expect(
      pathPickerEntries(listed, { filter: "", files: true, showHidden: true }).map((e) => e.name),
    ).toEqual(["Developer", "notes", ".codex", ".env.schema"]);
  });

  it("keeps dot entries back until the search starts with a dot", () => {
    expect(
      pathPickerEntries(listed, { filter: "", files: true, showHidden: false }).map((e) => e.name),
    ).toEqual(["Developer", "notes"]);
    expect(
      pathPickerEntries(listed, { filter: ".c", files: true, showHidden: false }).map(
        (e) => e.name,
      ),
    ).toEqual([".codex"]);
  });

  it("leaves files out of a folder picker", () => {
    expect(pathPickerEntries(listed, { filter: "env", files: false, showHidden: true })).toEqual(
      [],
    );
  });
});

describe("isFolderReadFailure", () => {
  it("tells a folder that could not be read from other browse failures", () => {
    expect(
      isFolderReadFailure(
        new FilesystemBrowseError({ partialPath: "~/x/", failure: "read_directory_failed" }),
      ),
    ).toBe(true);
    expect(
      isFolderReadFailure(
        new FilesystemBrowseError({ partialPath: "D:\\x\\", failure: "windows_path_unsupported" }),
      ),
    ).toBe(false);
    expect(isFolderReadFailure({ _tag: "EnvironmentRpcUnavailableError" })).toBe(false);
    expect(isFolderReadFailure(null)).toBe(false);
  });
});

describe("pathPickerNewFolder", () => {
  const home = listing("/home/me", entry("Developer"), entry("notes.txt", "file"));

  it("offers a typed name the folder does not hold, under the folder's resolved path", () => {
    expect(
      pathPickerNewFolder({ browsePath: "~/", filter: "worktrees", browsed: home, parent: null }),
    ).toBe("/home/me/worktrees");
    expect(
      pathPickerNewFolder({
        browsePath: "D:\\",
        filter: "worktrees",
        browsed: listing("D:\\"),
        parent: null,
      }),
    ).toBe("D:\\worktrees");
    expect(
      pathPickerNewFolder({
        browsePath: "C:/Users/me/",
        filter: "lanes ",
        browsed: listing("C:\\Users\\me"),
        parent: null,
      }),
    ).toBe("C:\\Users\\me\\lanes");
  });

  it("never offers a name that is already taken, by a folder or a file, in any case", () => {
    for (const filter of ["Developer", "developer", "notes.txt", "", ".", "..", "  "]) {
      expect(pathPickerNewFolder({ browsePath: "~/", filter, browsed: home, parent: null })).toBe(
        null,
      );
    }
  });

  it("offers a path in a missing folder once its parent shows the folder is absent", () => {
    const parent = listing("/home/me", entry("Developer"));
    expect(
      pathPickerNewFolder({ browsePath: "~/worktrees/", filter: "", browsed: null, parent }),
    ).toBe("/home/me/worktrees");
    expect(
      pathPickerNewFolder({ browsePath: "~/loom/", filter: "lanes", browsed: null, parent }),
    ).toBe("/home/me/loom/lanes");
  });

  it("offers nothing while the browsed folder's absence is unproven", () => {
    const taken = listing("/home/me", entry("worktrees", "file"));
    expect(
      pathPickerNewFolder({ browsePath: "~/worktrees/", filter: "", browsed: null, parent: taken }),
    ).toBe(null);
    expect(
      pathPickerNewFolder({ browsePath: "~/worktrees/", filter: "", browsed: null, parent: null }),
    ).toBe(null);
  });
});

describe("pathPickerParentProbe", () => {
  it("asks the parent about a named folder, and nothing for a root or a dot segment", () => {
    expect(pathPickerParentProbe("~/worktrees/")).toBe("~/worktrees");
    expect(pathPickerParentProbe("D:\\dev\\worktrees\\")).toBe("D:\\dev\\worktrees");
    for (const root of ["/", "~/", "D:\\", "\\\\server\\share\\", "~/a/../"]) {
      expect(pathPickerParentProbe(root)).toBe(null);
    }
  });
});
