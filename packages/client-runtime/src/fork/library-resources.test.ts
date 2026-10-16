import { describe, expect, it } from "vite-plus/test";
import type { LibraryResource } from "@t3tools/contracts/fork";
import { resourceLink, validateResources } from "./library-resources.ts";
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
