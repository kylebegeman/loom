import { describe, expect, it } from "vite-plus/test";
import {
  libraryFolderChoice,
  libraryNewFolderPath,
  libraryPlacementManaged,
} from "./library-placement.ts";

const app = { remoteUrl: "https://github.com/owner/app", relativePath: "app" };
const repository = (relativePath: string, remoteUrl: string | null) => ({
  path: `/work/${relativePath}`,
  relativePath,
  remoteUrl,
  head: null,
  branch: null,
});

describe("libraryFolderChoice", () => {
  it("downloads into a missing folder or an empty one", () => {
    expect(libraryFolderChoice({ exists: false, repositories: [] }, [app])).toBe("clone");
    expect(libraryFolderChoice({ exists: true, repositories: [] }, [app], true)).toBe("clone");
    expect(libraryFolderChoice({ exists: true, repositories: [] }, [app])).toBe("clone");
  });

  it("uses a folder only when it holds the selected repository", () => {
    expect(
      libraryFolderChoice(
        { exists: true, repositories: [repository(".", "git@github.com:owner/app.git")] },
        [app],
      ),
    ).toBe("reuse");
    expect(
      libraryFolderChoice(
        { exists: true, repositories: [repository(".", "https://github.com/owner/other")] },
        [app],
      ),
    ).toBe("occupied");
  });

  it("refuses a folder that holds other files", () => {
    expect(libraryFolderChoice({ exists: true, repositories: [] }, [app], false)).toBe("occupied");
  });

  it("matches a local repository by where the project keeps it", () => {
    const local = { remoteUrl: null, relativePath: "tool" };
    expect(
      libraryFolderChoice({ exists: true, repositories: [repository("tool", null)] }, [local, app]),
    ).toBe("occupied");
    expect(
      libraryFolderChoice({ exists: true, repositories: [repository(".", null)] }, [local]),
    ).toBe("reuse");
  });
});

describe("libraryPlacementManaged", () => {
  it("follows the preview's ownership over the strategy guess", () => {
    expect(libraryPlacementManaged({ ownership: "borrowed" }, "clone")).toBe(false);
    expect(libraryPlacementManaged({ ownership: "managed" }, "reuse")).toBe(true);
    expect(libraryPlacementManaged(null, "clone")).toBe(true);
    expect(libraryPlacementManaged(undefined, "reuse")).toBe(false);
  });
});

describe("libraryNewFolderPath", () => {
  it("names the folder from the title and steps past names already there", () => {
    expect(libraryNewFolderPath("/work", "My App")).toBe("/work/my-app");
    expect(libraryNewFolderPath("/work/", "My App", ["My-App", "my-app-2"])).toBe("/work/my-app-3");
  });
});
