import { describe, expect, it } from "vite-plus/test";
import type { LibraryResource } from "@t3tools/contracts/fork";
import { libraryGitHubRepository, resourceLink, validateResources } from "./library-resources.ts";
const repository = (path: string): LibraryResource => ({
  id: path,
  title: path,
  remoteUrl: null,
  relativePath: path,
  defaultBranch: null,
});
describe("Library resource validation", () => {
  it("allows root imports and separate repository folders", () => {
    expect(validateResources([repository(".")])).toBeNull();
    expect(validateResources([repository("app"), repository("platform")])).toBeNull();
  });
  it("rejects path escape and overlapping folders on case-insensitive hosts", () => {
    for (const path of ["../app", "/app", "app/../tool", "app//tool", "C:/app", "app\nother"])
      expect(validateResources([repository(path)])).not.toBeNull();
    expect(validateResources([repository("App"), repository("app/tool")])).not.toBeNull();
    expect(validateResources([repository("."), repository("app")])).not.toBeNull();
  });
  it("keeps reference links out of repository path rules and rejects active URLs", () => {
    const link: LibraryResource = {
      ...repository(""),
      title: "Design",
      kind: "link",
      url: "https://example.com/design",
    };
    expect(validateResources([link])).toBeNull();
    expect(resourceLink({ ...link, url: "javascript:alert(1)" })).toBeNull();
    expect(validateResources([{ ...link, url: "file:///private" }])).not.toBeNull();
    expect(resourceLink({ ...link, url: "https://user:secret@example.com/private" })).toBeNull();
    expect(resourceLink({ ...link, url: "https://example.com/\nprivate" })).toBeNull();
  });
});

it("binds Vault selection to the exact GitHub repository across supported transports", () => {
  for (const remote of [
    "https://github.com/Acme/App.git",
    "git@github.com:acme/app.git",
    "ssh://git@github.com/acme/app.git",
  ])
    expect(libraryGitHubRepository(remote)).toBe("acme/app");
  for (const remote of [
    null,
    "http://github.com/acme/app",
    "https://github.com.evil.test/acme/app",
    "https://name:secret@github.com/acme/app",
    "https://gitlab.com/acme/app",
  ])
    expect(libraryGitHubRepository(remote)).toBeNull();
});
