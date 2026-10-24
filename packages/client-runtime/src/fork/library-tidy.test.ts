import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryCopyStatus,
  LibraryRepositoryHealth,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { Atom, AtomRegistry } from "effect/reactivity";
import type { ProjectEntry } from "./library-project-list.ts";
import {
  libraryCopyRemovalPermission,
  libraryTidyReasonLabel,
  libraryTidySuggestions,
  runLibraryTidy,
  type LibraryTidyReason,
} from "./library-tidy.ts";

const dorothy = EnvironmentId.make("dorothy");
const nora = EnvironmentId.make("nora");
const now = Date.parse("2026-10-16T12:00:00.000Z");
const checkedAt = "2026-10-16T11:59:00.000Z";

const copy = (patch: Partial<LibraryWorkingCopy>): LibraryWorkingCopy => ({
  id: "copy",
  projectId: "loom",
  projectRevision: 1,
  environmentId: dorothy,
  rootPath: "/Users/kyle/Developer/loom",
  repositories: [
    {
      resourceId: "web",
      path: "/Users/kyle/Developer/loom",
      localProjectId: ProjectId.make("local"),
      head: "abc",
      branch: "main",
    },
  ],
  ownership: "managed",
  state: "ready",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...patch,
});
const repository = (patch: Partial<LibraryRepositoryHealth> = {}): LibraryRepositoryHealth => ({
  resourceId: "web",
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  uncommittedFiles: 0,
  unpushedCommits: 0,
  checkedAt,
  ...patch,
});
const health = (
  target: LibraryWorkingCopy,
  repositories: readonly LibraryRepositoryHealth[] = [repository()],
): LibraryCopyHealth => ({
  copyId: target.id,
  environmentId: target.environmentId,
  repositories,
  checkedAt,
});
const entry = (copies: readonly LibraryWorkingCopy[], patch: Partial<ProjectEntry> = {}) =>
  ({
    project: {
      id: "loom",
      title: "Loom",
      brief: "",
      revision: 3,
      resources: [],
      archived: false,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    color: "teal",
    copies,
    localIcon: null,
    conversations: 0,
    attention: { waiting: 0, failed: 0, working: 0 },
    // Nearly four weeks before `now`, past the two-week resting threshold.
    activeAt: "2026-09-20T00:00:00.000Z",
    ...patch,
  }) satisfies ProjectEntry;
const online = () => true;
const removable = () => true;

describe("libraryTidySuggestions", () => {
  const clean = copy({ id: "clean" });
  const dirty = copy({ id: "dirty" });
  const unpushed = copy({ id: "unpushed" });
  const away = copy({ id: "away", environmentId: nora });
  const unknown = copy({ id: "unknown" });

  it.each<{
    readonly name: string;
    readonly copy: LibraryWorkingCopy;
    readonly health: LibraryCopyHealth | undefined;
    readonly connected?: boolean;
    readonly reasons: readonly LibraryTidyReason[];
  }>([
    { name: "a clean, pushed copy", copy: clean, health: health(clean), reasons: [] },
    {
      name: "uncommitted files",
      copy: dirty,
      health: health(dirty, [repository({ uncommittedFiles: 2 })]),
      reasons: [{ kind: "uncommitted", files: 2 }],
    },
    {
      name: "unpushed commits",
      copy: unpushed,
      health: health(unpushed, [repository({ ahead: 1, unpushedCommits: 1 })]),
      reasons: [{ kind: "unpushed", commits: 1 }],
    },
    {
      name: "commits on a branch without an upstream",
      copy: unpushed,
      health: health(unpushed, [
        { resourceId: "web", branch: "draft", uncommittedFiles: 1, unpushedCommits: 4, checkedAt },
      ]),
      reasons: [
        { kind: "uncommitted", files: 1 },
        { kind: "unpushed", commits: 4 },
      ],
    },
    {
      name: "an offline computer, whatever its last health said",
      copy: away,
      health: health(away),
      connected: false,
      reasons: [{ kind: "offline" }],
    },
    { name: "missing health", copy: unknown, health: undefined, reasons: [{ kind: "unchecked" }] },
    {
      name: "health for a different copy",
      copy: unknown,
      health: health(clean),
      reasons: [{ kind: "unchecked" }],
    },
    {
      name: "health that leaves out a repository",
      copy: unknown,
      health: health(unknown, []),
      reasons: [{ kind: "unchecked" }],
    },
    {
      name: "a repository that could not be read",
      copy: unknown,
      health: health(unknown, [repository({ error: "missing" })]),
      reasons: [{ kind: "unchecked" }],
    },
    {
      name: "a copy that is not ready",
      copy: copy({ id: "missing", state: "missing" }),
      health: undefined,
      reasons: [{ kind: "unavailable" }],
    },
    {
      name: "a copy with no repositories to vouch for it",
      copy: copy({ id: "plain", repositories: [] }),
      health: { copyId: "plain", environmentId: dorothy, repositories: [], checkedAt },
      reasons: [{ kind: "no-repositories" }],
    },
  ])("sorts $name", ({ copy: target, health: read, connected = true, reasons }) => {
    const result = libraryTidySuggestions({
      entry: entry([target]),
      health: read ? [read] : [],
      connected: () => connected,
      canRemove: removable,
      now,
    });
    if (reasons.length) {
      expect(result.safe).toEqual([]);
      expect(result.attention).toEqual([{ copy: target, reasons }]);
    } else {
      expect(result.safe).toEqual([target]);
      expect(result.attention).toEqual([]);
    }
  });

  it("keeps the project's copy order and skips released copies", () => {
    const second = copy({ id: "second" });
    const released = copy({ id: "released", state: "released" });
    const result = libraryTidySuggestions({
      entry: entry([clean, dirty, released, second]),
      health: [health(second), health(dirty, [repository({ uncommittedFiles: 1 })]), health(clean)],
      connected: online,
      canRemove: removable,
      now,
    });
    expect(result.safe.map((entry) => entry.id)).toEqual(["clean", "second"]);
    expect(result.attention.map((entry) => entry.copy.id)).toEqual(["dirty"]);
  });

  it("never offers a copy this client may not remove on its computer", () => {
    const result = libraryTidySuggestions({
      entry: entry([clean, away]),
      health: [health(clean), health(away)],
      connected: online,
      canRemove: (target) => target.environmentId !== nora,
      now,
    });
    expect(result.safe).toEqual([clean]);
    expect(result.attention).toEqual([{ copy: away, reasons: [{ kind: "no-permission" }] }]);
  });

  it("reports an offline computer before a missing permission", () => {
    const result = libraryTidySuggestions({
      entry: entry([away]),
      health: [],
      connected: () => false,
      canRemove: () => false,
      now,
    });
    expect(result.attention).toEqual([{ copy: away, reasons: [{ kind: "offline" }] }]);
  });

  it("suggests archiving only a current project that is resting", () => {
    const suggest = (patch: Partial<ProjectEntry>) =>
      libraryTidySuggestions({
        entry: entry([], patch),
        health: [],
        connected: online,
        canRemove: removable,
        now,
      }).suggestArchive;
    expect(suggest({})).toBe(true);
    expect(suggest({ activeAt: checkedAt })).toBe(false);
    expect(suggest({ project: { ...entry([]).project, archived: true } })).toBe(false);
  });

  it("labels each reason in plain words", () => {
    expect(libraryTidyReasonLabel({ kind: "uncommitted", files: 1 })).toBe("1 uncommitted file");
    expect(libraryTidyReasonLabel({ kind: "unpushed", commits: 3 })).toBe("3 unpushed commits");
    expect(libraryTidyReasonLabel({ kind: "offline" })).toBe("Computer offline");
  });
});

describe("libraryCopyRemovalPermission", () => {
  it("reads each copy's own computer for the command its ownership needs", () => {
    const grantedOn = (granted: EnvironmentId) => ({
      permissionAtom: (id: EnvironmentId) => Atom.make(id === granted),
    });
    const canRemove = AtomRegistry.make().get(
      libraryCopyRemovalPermission(
        { releaseCopy: grantedOn(dorothy), unregisterCopy: grantedOn(nora) },
        [dorothy, nora],
      ),
    );
    expect(canRemove(copy({ environmentId: dorothy }))).toBe(true);
    expect(canRemove(copy({ environmentId: dorothy, ownership: "borrowed" }))).toBe(false);
    expect(canRemove(copy({ environmentId: nora, ownership: "borrowed" }))).toBe(true);
    expect(canRemove(copy({ environmentId: nora }))).toBe(false);
  });
});

describe("runLibraryTidy", () => {
  const status = (target: LibraryWorkingCopy, patch: Partial<LibraryCopyStatus> = {}) =>
    ({
      copy: target,
      blockers: [],
      reviewToken: `token:${target.id}`,
      health: health(target),
      ...patch,
    }) satisfies LibraryCopyStatus;

  const harness = (statuses: Record<string, LibraryCopyStatus | Error>) => {
    const calls: string[] = [];
    return {
      calls,
      canRemove: removable,
      readStatus: async (target: LibraryWorkingCopy) => {
        calls.push(`status:${target.id}`);
        const result = statuses[target.id];
        if (!result || result instanceof Error) throw result ?? new Error("no status");
        return result;
      },
      remove: async (current: LibraryCopyStatus, reviewToken: string) => {
        calls.push(`remove:${current.copy.id}:${reviewToken}`);
        return { ...current.copy, state: "released" as const };
      },
      register: async (removed: LibraryWorkingCopy) => {
        calls.push(`register:${removed.id}:${removed.state}`);
      },
      archiveProject: async () => {
        calls.push("archive");
      },
    };
  };

  it("re-reads each copy, releases it in order with the fresh token, then archives", async () => {
    const first = copy({ id: "first" });
    const borrowed = copy({ id: "borrowed", ownership: "borrowed" });
    const run = harness({ first: status(first), borrowed: status(borrowed) });
    const result = await runLibraryTidy({
      ...run,
      copies: [first, borrowed],
      archive: true,
      connected: online,
    });
    expect(run.calls).toEqual([
      "status:first",
      "remove:first:token:first",
      "register:first:released",
      "status:borrowed",
      "remove:borrowed:token:borrowed",
      "register:borrowed:released",
      "archive",
    ]);
    expect(result.copies.map((entry) => entry.outcome)).toEqual(["released", "released"]);
    expect(result.archive).toEqual({ ok: true });
  });

  it("never releases a copy that changed after the dialog opened", async () => {
    const edited = copy({ id: "edited" });
    const committed = copy({ id: "committed" });
    const unreadable = copy({ id: "unreadable" });
    const run = harness({
      edited: status(edited, { health: health(edited, [repository({ uncommittedFiles: 1 })]) }),
      committed: status(committed, {
        health: health(committed, [repository({ ahead: 2, unpushedCommits: 2 })]),
      }),
      // A computer that cannot report health no longer proves the copy is clean.
      unreadable: status(unreadable, { health: undefined }),
    });
    const result = await runLibraryTidy({
      ...run,
      copies: [edited, committed, unreadable],
      archive: false,
      connected: online,
    });
    expect(run.calls.filter((call) => !call.startsWith("status:"))).toEqual([]);
    expect(result.copies).toEqual([
      { copy: edited, outcome: "kept", reasons: [{ kind: "uncommitted", files: 1 }] },
      { copy: committed, outcome: "kept", reasons: [{ kind: "unpushed", commits: 2 }] },
      { copy: unreadable, outcome: "kept", reasons: [{ kind: "unchecked" }] },
    ]);
    expect(result.archive).toBeNull();
  });

  it("keeps copies whose computer went offline or that the server would block", async () => {
    const away = copy({ id: "away", environmentId: nora });
    const busy = copy({ id: "busy" });
    const run = harness({
      busy: status(busy, {
        blockers: ["A conversation is still running in this working folder."],
        reviewToken: null,
      }),
    });
    const result = await runLibraryTidy({
      ...run,
      copies: [away, busy],
      archive: false,
      connected: (id) => id !== nora,
    });
    expect(run.calls).toEqual(["status:busy"]);
    expect(result.copies).toEqual([
      { copy: away, outcome: "kept", reasons: [{ kind: "offline" }] },
      {
        copy: busy,
        outcome: "blocked",
        blockers: ["A conversation is still running in this working folder."],
      },
    ]);
  });

  it("reports a failed copy, continues with the rest and still archives", async () => {
    const broken = copy({ id: "broken" });
    const fine = copy({ id: "fine" });
    const run = harness({ broken: new Error("Computer stopped responding"), fine: status(fine) });
    const result = await runLibraryTidy({
      ...run,
      copies: [broken, fine],
      archive: true,
      connected: online,
    });
    expect(result.copies).toEqual([
      { copy: broken, outcome: "failed", message: "Computer stopped responding" },
      { copy: fine, outcome: "released" },
    ]);
    expect(result.archive).toEqual({ ok: true });
  });

  it("keeps a copy whose removal permission is missing on its computer", async () => {
    const managed = copy({ id: "managed" });
    const borrowed = copy({ id: "borrowed", ownership: "borrowed" });
    const run = harness({ managed: status(managed), borrowed: status(borrowed) });
    const result = await runLibraryTidy({
      ...run,
      copies: [managed, borrowed],
      archive: false,
      connected: online,
      // Only unregistering is granted, so the managed copy cannot be released.
      canRemove: (target) => target.ownership === "borrowed",
    });
    expect(run.calls).toEqual([
      "status:managed",
      "status:borrowed",
      "remove:borrowed:token:borrowed",
      "register:borrowed:released",
    ]);
    expect(result.copies).toEqual([
      { copy: managed, outcome: "kept", reasons: [{ kind: "no-permission" }] },
      { copy: borrowed, outcome: "released" },
    ]);
  });

  it("records an already released copy without releasing it again", async () => {
    const gone = copy({ id: "gone" });
    const run = harness({ gone: status({ ...gone, state: "released" }, { reviewToken: null }) });
    const result = await runLibraryTidy({
      ...run,
      copies: [gone],
      archive: false,
      connected: online,
    });
    expect(run.calls).toEqual(["status:gone", "register:gone:released"]);
    expect(result.copies).toEqual([{ copy: gone, outcome: "released" }]);
  });

  it("reports an archive failure separately from the copies", async () => {
    const run = harness({});
    const result = await runLibraryTidy({
      ...run,
      archiveProject: async () => {
        throw new Error("The project changed. Refresh and try again.");
      },
      copies: [],
      archive: true,
      connected: online,
    });
    expect(result.archive).toEqual({
      ok: false,
      message: "The project changed. Refresh and try again.",
    });
  });
});
