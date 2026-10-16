import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, type ProjectScript } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import {
  compactLibraryProfile,
  libraryProfileChange,
  libraryProfileComputerIds,
  libraryProfileProblem,
  libraryProfileScriptSources,
  librarySecretNameFromInput,
  libraryToolsWithVersion,
  libraryToolText,
} from "./library-project-profile.ts";

const dorothy = EnvironmentId.make("dorothy");
const script = (id: string): ProjectScript => ({
  id,
  name: id,
  command: `pnpm ${id}`,
  icon: "play",
  runOnWorktreeCreate: false,
});
const copy = (patch: Partial<LibraryWorkingCopy>): LibraryWorkingCopy => ({
  id: "copy",
  projectId: "project",
  projectRevision: 1,
  environmentId: dorothy,
  rootPath: "/work/aspectavy",
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...patch,
});
const local = (id: string, scripts: ProjectScript[], environmentId = dorothy) => ({
  environmentId,
  id: ProjectId.make(id),
  title: id,
  scripts,
});

describe("libraryProfileScriptSources", () => {
  it("offers each copy's local projects that have scripts, root folder first, once each", () => {
    const repository = (id: string) => ({
      resourceId: id,
      path: `/work/aspectavy/${id}`,
      localProjectId: ProjectId.make(id),
      head: null,
      branch: null,
    });
    const sources = libraryProfileScriptSources(
      [
        copy({
          rootLocalProjectId: ProjectId.make("root"),
          repositories: [repository("web"), repository("empty"), repository("missing")],
        }),
        copy({ id: "again", rootLocalProjectId: ProjectId.make("root") }),
      ],
      [
        local("web", [script("dev")]),
        local("root", [script("setup"), script("test")]),
        local("empty", []),
        local("web", [script("other")], EnvironmentId.make("elsewhere")),
      ],
    );
    expect(sources.map((source) => [source.copyId, source.title, source.scripts.length])).toEqual([
      ["copy", "root", 2],
      ["copy", "web", 1],
    ]);
  });
});

describe("profile drafts", () => {
  it("saves only what someone chose and removes a profile left empty", () => {
    expect(
      compactLibraryProfile({ scripts: [], requiredTools: [{ id: "node" }], allowMini: false }),
    ).toEqual({ requiredTools: [{ id: "node" }], allowMini: false });
    expect(compactLibraryProfile({ scripts: [], secretNames: [] })).toBeNull();
  });

  it("turns typed names into environment variable names and refuses values", () => {
    expect(librarySecretNameFromInput(" github token ")).toBe("GITHUB_TOKEN");
    expect(librarySecretNameFromInput("openai-api-key")).toBe("OPENAI_API_KEY");
    expect(librarySecretNameFromInput("TOKEN=abc")).toBeNull();
    expect(librarySecretNameFromInput("AKIAIOSFODNN7EXAMPLE")).toBeNull();
    // Uppercasing would otherwise turn a pasted token into a plausible name.
    expect(librarySecretNameFromInput("ghp_abcdefghijklmnopqrstuvwxyz0123")).toBeNull();
    expect(librarySecretNameFromInput("sk-proj-abc123defghijklmnopq")).toBeNull();
    expect(librarySecretNameFromInput("")).toBeNull();
  });

  it("explains what keeps a profile from saving", () => {
    expect(libraryProfileProblem({ requiredTools: [{ id: "node", minimumVersion: "22" }] })).toBe(
      null,
    );
    expect(libraryProfileProblem({ requiredTools: [{ id: "node", minimumVersion: ">=22" }] })).toBe(
      "Use a plain version number for Node.js, like 20 or 3.12.",
    );
    expect(
      libraryProfileProblem({ scripts: [{ ...script("deploy"), command: "API_KEY=abc deploy" }] }),
    ).toMatch(/^Script 1 looks like it holds a secret/);
    // A script saved before a stricter rule can stay; a new one like it cannot.
    const older = { scripts: [{ ...script("deploy"), command: "API_KEY=abc deploy" }] };
    expect(libraryProfileProblem(older, older)).toBeNull();
    expect(
      libraryProfileProblem(
        { scripts: [...older.scripts, { ...older.scripts[0]!, id: "b" }] },
        older,
      ),
    ).toMatch(/^Script 2 looks like it holds a secret/);
  });

  it("sends a profile only when the edit changed it", () => {
    const saved = { requiredTools: [{ id: "node", minimumVersion: "22" }], allowMini: true };
    // Untouched, or the same fields in another order, keeps the saved profile.
    expect(libraryProfileChange({ ...saved }, saved)).toBeUndefined();
    expect(
      libraryProfileChange(
        { allowMini: true, requiredTools: [{ minimumVersion: "22", id: "node" }] },
        saved,
      ),
    ).toBeUndefined();
    // Emptied lists count as cleared, not changed.
    expect(libraryProfileChange({ ...saved, scripts: [] }, saved)).toBeUndefined();
    expect(libraryProfileChange({ scripts: [] }, undefined)).toBeUndefined();
    expect(libraryProfileChange({ ...saved, allowMini: false }, saved)).toEqual({
      ...saved,
      allowMini: false,
    });
    expect(libraryProfileChange({ requiredTools: [], allowMini: undefined }, saved)).toBeNull();
  });

  it("edits tools and lists the computers a project can prefer", () => {
    const tools = [{ id: "node" }, { id: "pnpm", minimumVersion: "9" }];
    expect(libraryToolsWithVersion(tools, "node", " 22 ")).toEqual([
      { id: "node", minimumVersion: "22" },
      tools[1],
    ]);
    expect(libraryToolsWithVersion(tools, "pnpm", " ")).toEqual([{ id: "node" }, { id: "pnpm" }]);
    expect(libraryToolText({ id: "node", minimumVersion: "22" })).toBe("Node.js 22+");
    expect(libraryToolText({ id: "zig" })).toBe("zig");
    const gone = EnvironmentId.make("gone");
    expect(
      libraryProfileComputerIds(
        [
          { environmentId: dorothy, supportsExecution: true },
          { environmentId: EnvironmentId.make("viewer"), supportsExecution: false },
        ],
        [gone, dorothy],
      ),
    ).toEqual([dorothy, gone]);
  });
});
