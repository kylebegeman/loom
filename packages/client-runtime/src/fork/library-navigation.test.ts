import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, it, expect } from "vite-plus/test";
import {
  libraryProjectScopeKey,
  parseLibraryProjectScope,
  libraryThreadMatchesScope,
  libraryProjectForLocalRefs,
} from "./library-navigation.ts";
import type { LibraryThreadSummary } from "@t3tools/contracts/fork";
const row = (
  projectId: string,
  localProjectId: string,
  resourceIds: string[] = [],
): LibraryThreadSummary => ({
  id: `host:${localProjectId}`,
  projectId,
  localProjectId: ProjectId.make(localProjectId),
  environmentId: EnvironmentId.make("host"),
  threadId: ThreadId.make(`thread-${localProjectId}`),
  resourceIds,
  workingCopyId: null,
  title: "Saved work",
  status: "idle",
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  syncedAt: "2026-10-15T12:00:00.000Z",
  sequence: 1,
});

describe("one project filter for durable and existing work", () => {
  it("round trips component IDs without inventing extra selectors", () => {
    const key = libraryProjectScopeKey("Aspect:Avy", "iOS:one");
    expect(parseLibraryProjectScope(key)).toEqual({
      projectId: "Aspect:Avy",
      resourceId: "iOS:one",
    });
    expect(parseLibraryProjectScope("physical:project")).toBeNull();
    expect(parseLibraryProjectScope("library:%bad")).toBeNull();
  });
  it("project scope includes all components while component scope stays explicit", () => {
    const parent = parseLibraryProjectScope(libraryProjectScopeKey("AspectAvy"));
    const ios = parseLibraryProjectScope(libraryProjectScopeKey("AspectAvy", "ios"));
    expect(libraryThreadMatchesScope(row("AspectAvy", "root"), parent)).toBe(true);
    expect(libraryThreadMatchesScope(row("AspectAvy", "ios", ["ios"]), ios)).toBe(true);
    expect(libraryThreadMatchesScope(row("AspectAvy", "root", ["ios", "web"]), ios)).toBe(false);
    expect(libraryThreadMatchesScope(row("other", "ios", ["ios"]), ios)).toBe(false);
  });
  it("only coalesces source refs with one explicit project identity", () => {
    const rows = [row("AspectAvy", "web"), row("AspectAvy", "ios")];
    expect(
      libraryProjectForLocalRefs(rows, [
        { environmentId: "host", projectId: "web" },
        { environmentId: "host", projectId: "ios" },
      ]),
    ).toBe("AspectAvy");
    expect(
      libraryProjectForLocalRefs(rows, [{ environmentId: "other-host", projectId: "web" }]),
    ).toBeNull();
    expect(
      libraryProjectForLocalRefs(
        [...rows, row("other", "web")],
        [{ environmentId: "host", projectId: "web" }],
      ),
    ).toBeNull();
  });
});
