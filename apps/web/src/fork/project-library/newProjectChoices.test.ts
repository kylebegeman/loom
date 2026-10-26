import { describe, expect, it } from "vite-plus/test";
import type { LibraryResource } from "@t3tools/contracts/fork";
import {
  gitRepositoryChoice,
  holdsGitRemote,
  newProjectChoices,
  newProjectDraftKey,
} from "./newProjectChoices";

const rows = (query: string, blueprints = false, draft: string | null = null) =>
  newProjectChoices({ query, blueprints, draft });

describe("newProjectChoices", () => {
  it("offers every way to start, with blueprints only where the Library keeps them", () => {
    expect(rows("").map((row) => row.title)).toEqual([
      "Empty project",
      "Existing folder",
      "Git repository",
    ]);
    expect(rows("", true).map((row) => row.title)).toEqual([
      "Empty project",
      "Existing folder",
      "Git repository",
      "From a blueprint",
    ]);
    expect(rows("", true).at(-1)?.target).toEqual({
      step: "create",
      page: "blueprint",
      title: "",
      repository: "",
    });
  });

  it("leads with what the typed text means and keeps the other ways below", () => {
    const [clone, ...rest] = rows("github.com/example/harbor");
    expect(clone).toMatchObject({
      title: "Clone harbor",
      target: {
        step: "create",
        page: "name",
        title: "harbor",
        repository: "https://github.com/example/harbor",
      },
    });
    expect(rest.map((row) => row.id)).toEqual(["empty", "folder", "git"]);
    expect(rows("~/work/harbor")[0]).toMatchObject({
      title: "Use folder: harbor",
      target: { step: "import", path: "~/work/harbor" },
    });
    expect(rows("  Harbor notes ")[0]).toMatchObject({
      title: "New project: Harbor notes",
      target: { step: "create", page: "name", title: "Harbor notes", repository: "" },
    });
  });

  it("names the choice whose draft is kept as a return to it", () => {
    const draft = newProjectDraftKey({ step: "create", page: "name", title: "", repository: "" });
    const [empty, folder] = rows("", false, draft);
    expect(empty?.description).toBe("Return to your project draft");
    expect(folder?.description).toBe("Browse files on a connected computer");
    // A name typed since starts its own draft.
    expect(rows("Harbor", false, draft)[0]?.description).toBe("Start from this name");
  });
});

describe("holdsGitRemote", () => {
  const repository = (remoteUrl: string): LibraryResource => ({
    id: remoteUrl,
    kind: "repository",
    title: "harbor",
    remoteUrl,
    relativePath: "harbor",
    defaultBranch: null,
  });
  it("finds the started repository over HTTPS or SSH and nothing else", () => {
    const pasted = "git@github.com:example/harbor.git";
    expect(holdsGitRemote([repository("https://github.com/example/harbor")], pasted)).toBe(true);
    expect(holdsGitRemote([repository("https://github.com/example/dock")], pasted)).toBe(false);
    expect(holdsGitRemote([], pasted)).toBe(false);
  });
});

describe("gitRepositoryChoice", () => {
  it("clones Git remotes and refuses web links and partial addresses", () => {
    expect(gitRepositoryChoice("git@github.com:example/harbor.git")).toMatchObject({
      title: "Clone harbor",
      target: { repository: "git@github.com:example/harbor.git", title: "harbor" },
    });
    expect(gitRepositoryChoice("https://example.com/docs")).toBeNull();
    expect(gitRepositoryChoice("github.com/example")).toBeNull();
    expect(gitRepositoryChoice("")).toBeNull();
  });
});
