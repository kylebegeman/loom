import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryCopyHealth, LibraryRepositoryHealth } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryLaunchCandidateSummary,
  libraryLaunchFreshness,
  rankLibraryLaunchCandidates,
  type LibraryLaunchComputer,
  type LibraryLaunchCopy,
  type LibraryLaunchThread,
} from "./library-launch.ts";

const MINI = EnvironmentId.make("mini");
const BOOK = EnvironmentId.make("book");
const STUDIO = EnvironmentId.make("studio");
const CHECKED = "2026-10-16T10:00:00.000Z";

const LABELS: Record<string, string> = { mini: "Mac Mini", book: "MacBook", studio: "Studio" };

const computer = (
  environmentId: EnvironmentId,
  overrides: Partial<LibraryLaunchComputer> = {},
): LibraryLaunchComputer => ({
  environmentId,
  label: LABELS[environmentId] ?? environmentId,
  online: true,
  supportsExecution: true,
  workingThreads: 0,
  ...overrides,
});

const repository = (overrides: Partial<LibraryRepositoryHealth> = {}): LibraryRepositoryHealth => ({
  resourceId: "app",
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  uncommittedFiles: 0,
  unpushedCommits: 0,
  checkedAt: CHECKED,
  ...overrides,
});

const health = (
  copyId: string,
  environmentId: EnvironmentId,
  repositories: readonly LibraryRepositoryHealth[] = [repository()],
): LibraryCopyHealth => ({ copyId, environmentId, repositories, checkedAt: CHECKED });

const copy = (
  id: string,
  environmentId: EnvironmentId,
  published?: LibraryCopyHealth,
): LibraryLaunchCopy => ({ id, environmentId, ...(published ? { health: published } : {}) });

const rank = (input: {
  computers: readonly LibraryLaunchComputer[];
  copies?: readonly LibraryLaunchCopy[];
  threads?: readonly LibraryLaunchThread[];
  live?: readonly LibraryCopyHealth[];
  resourceIds?: readonly string[] | null;
}) =>
  rankLibraryLaunchCandidates({
    computers: input.computers,
    copies: input.copies ?? [],
    threads: input.threads ?? [],
    resourceIds: input.resourceIds ?? null,
    liveHealth: new Map((input.live ?? []).map((entry) => [entry.copyId, entry])),
  });

const order = (ranking: ReturnType<typeof rank>) =>
  ranking.candidates.map((candidate) =>
    candidate.kind === "copy"
      ? `${candidate.environmentId}:${candidate.copyId}`
      : candidate.environmentId,
  );

describe("rankLibraryLaunchCandidates", () => {
  it("preselects the up-to-date copy over one that is behind, and says why", () => {
    const ranking = rank({
      computers: [computer(BOOK), computer(MINI)],
      copies: [copy("book-copy", BOOK), copy("mini-copy", MINI)],
      live: [health("book-copy", BOOK, [repository({ behind: 3 })]), health("mini-copy", MINI)],
    });
    expect(order(ranking)).toEqual(["mini:mini-copy", "book:book-copy"]);
    expect(ranking.preselected && libraryLaunchCandidateSummary(ranking.preselected)).toBe(
      "Mac Mini · online, up to date",
    );
    expect(libraryLaunchCandidateSummary(ranking.candidates[1]!)).toBe(
      "MacBook · online, 3 behind",
    );
  });

  it("never preselects an offline computer, even with the only up-to-date copy", () => {
    const ranking = rank({
      computers: [computer(MINI, { online: false }), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI))],
    });
    expect(order(ranking)).toEqual(["book", "mini:mini-copy"]);
    expect(ranking.preselected?.environmentId).toBe(BOOK);
    expect(ranking.candidates[1]!.reasons[0]).toBe("offline");
  });

  it("preselects nothing when every computer is offline", () => {
    const ranking = rank({
      computers: [computer(MINI, { online: false })],
      copies: [copy("mini-copy", MINI)],
    });
    expect(ranking.candidates).toHaveLength(1);
    expect(ranking.preselected).toBeNull();
  });

  it("leaves out computers that cannot run work", () => {
    const ranking = rank({
      computers: [computer(MINI, { supportsExecution: false }), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI))],
    });
    expect(order(ranking)).toEqual(["book"]);
    expect(ranking.preselected?.kind).toBe("get-copy");
  });

  it("prefers a copy that covers the scope over getting one, even when that copy is stale", () => {
    const ranking = rank({
      computers: [computer(BOOK), computer(MINI)],
      copies: [copy("mini-copy", MINI)],
      live: [health("mini-copy", MINI, [repository({ behind: 2, uncommittedFiles: 1 })])],
    });
    expect(order(ranking)).toEqual(["mini:mini-copy", "book"]);
    expect(ranking.candidates[0]!.reasons).toEqual(["online", "2 behind, 1 changed"]);
    expect(ranking.candidates[1]!.reasons).toEqual(["online", "no copy yet"]);
  });

  it("offers a copy on the best connected computer when the project has none", () => {
    const ranking = rank({
      computers: [
        computer(BOOK, { workingThreads: 2 }),
        computer(MINI),
        computer(STUDIO, { online: false }),
      ],
    });
    expect(order(ranking)).toEqual(["mini", "book", "studio"]);
    expect(ranking.preselected).toMatchObject({ kind: "get-copy", environmentId: MINI });
  });

  it("ranks up to date, then unchecked, then dirty or behind, then broken", () => {
    const ranking = rank({
      computers: [computer(MINI)],
      copies: [
        copy("broken", MINI),
        copy("dirty", MINI),
        copy("unknown", MINI),
        copy("fresh", MINI),
      ],
      live: [
        health("broken", MINI, [repository({ error: "missing" })]),
        health("dirty", MINI, [repository({ uncommittedFiles: 4 })]),
        health("fresh", MINI),
      ],
    });
    expect(order(ranking)).toEqual(["mini:fresh", "mini:unknown", "mini:dirty", "mini:broken"]);
    expect(ranking.candidates.map((candidate) => candidate.reasons[1])).toEqual([
      "up to date",
      "not checked",
      "4 changed",
      "folder missing",
    ]);
  });

  it("never preselects a broken copy, falling to the next usable candidate", () => {
    const ranking = rank({
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      live: [
        health("mini-copy", MINI, [repository({ error: "missing" })]),
        health("book-copy", BOOK, [repository({ error: "not-a-repository" })]),
      ],
    });
    expect(ranking.preselected).toBeNull();
    const withOther = rank({
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI)],
      live: [health("mini-copy", MINI, [repository({ error: "missing" })])],
    });
    expect(withOther.preselected).toMatchObject({ kind: "get-copy", environmentId: BOOK });
  });

  it("counts being ahead as up to date", () => {
    const ranking = rank({
      computers: [computer(MINI)],
      copies: [copy("mini-copy", MINI)],
      live: [health("mini-copy", MINI, [repository({ ahead: 2, unpushedCommits: 2 })])],
    });
    expect(ranking.candidates[0]).toMatchObject({ freshness: "up-to-date" });
  });

  it("judges only the repositories in scope", () => {
    const repositories = [
      repository({ resourceId: "app" }),
      repository({ resourceId: "docs", behind: 5 }),
    ];
    const scoped = rank({
      computers: [computer(MINI)],
      copies: [copy("mini-copy", MINI)],
      live: [health("mini-copy", MINI, repositories)],
      resourceIds: ["app"],
    });
    expect(scoped.candidates[0]).toMatchObject({ freshness: "up-to-date", behind: 0 });
    const whole = rank({
      computers: [computer(MINI)],
      copies: [copy("mini-copy", MINI)],
      live: [health("mini-copy", MINI, repositories)],
    });
    expect(whole.candidates[0]).toMatchObject({ freshness: "stale", behind: 5 });
  });

  it("uses published health until live health arrives, then live health wins", () => {
    const published = rank({
      computers: [computer(BOOK), computer(MINI)],
      copies: [
        copy("book-copy", BOOK, health("book-copy", BOOK)),
        copy("mini-copy", MINI, health("mini-copy", MINI, [repository({ behind: 1 })])),
      ],
    });
    expect(published.preselected?.environmentId).toBe(BOOK);
    const live = rank({
      computers: [computer(BOOK), computer(MINI)],
      copies: [
        copy("book-copy", BOOK, health("book-copy", BOOK)),
        copy("mini-copy", MINI, health("mini-copy", MINI, [repository({ behind: 1 })])),
      ],
      live: [health("book-copy", BOOK, [repository({ behind: 4 })]), health("mini-copy", MINI)],
    });
    expect(live.preselected?.environmentId).toBe(MINI);
  });

  it("ignores health that belongs to another copy", () => {
    const ranking = rank({
      computers: [computer(MINI)],
      copies: [copy("mini-copy", MINI, health("other", MINI))],
    });
    expect(ranking.candidates[0]).toMatchObject({ freshness: "unknown", health: null });
  });

  it("breaks a freshness tie by the computer used last for this project", () => {
    const ranking = rank({
      computers: [computer(BOOK), computer(MINI)],
      copies: [copy("book-copy", BOOK), copy("mini-copy", MINI)],
      live: [health("book-copy", BOOK), health("mini-copy", MINI)],
      threads: [
        { environmentId: MINI, workingCopyId: "mini-copy", updatedAt: "2026-10-15T09:00:00.000Z" },
        { environmentId: BOOK, workingCopyId: "book-copy", updatedAt: "2026-10-14T09:00:00.000Z" },
        { environmentId: BOOK, workingCopyId: null, updatedAt: "2026-10-16T09:00:00.000Z" },
      ],
    });
    expect(order(ranking)).toEqual(["book:book-copy", "mini:mini-copy"]);
    expect(ranking.candidates[0]!.reasons).toEqual(["online", "up to date", "used last"]);
    expect(ranking.candidates[1]!.reasons).toEqual(["online", "up to date"]);
  });

  it("does not let a recent use outrank a fresher copy", () => {
    const ranking = rank({
      computers: [computer(BOOK), computer(MINI)],
      copies: [copy("book-copy", BOOK), copy("mini-copy", MINI)],
      live: [health("book-copy", BOOK, [repository({ behind: 1 })]), health("mini-copy", MINI)],
      threads: [{ environmentId: BOOK, workingCopyId: "book-copy", updatedAt: CHECKED }],
    });
    expect(ranking.preselected?.environmentId).toBe(MINI);
  });

  it("breaks a last-used tie by the fewest working threads", () => {
    const ranking = rank({
      computers: [computer(MINI, { workingThreads: 3 }), computer(BOOK, { workingThreads: 1 })],
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      live: [health("mini-copy", MINI), health("book-copy", BOOK)],
    });
    expect(order(ranking)).toEqual(["book:book-copy", "mini:mini-copy"]);
    expect(ranking.candidates[0]!.reasons).toEqual(["online", "up to date", "1 working"]);
  });

  it("does not let fewer working threads outrank the computer used last", () => {
    const ranking = rank({
      computers: [computer(MINI, { workingThreads: 3 }), computer(BOOK)],
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      threads: [{ environmentId: MINI, workingCopyId: null, updatedAt: CHECKED }],
    });
    expect(ranking.preselected?.environmentId).toBe(MINI);
  });

  it("prefers the copy used last when one computer holds two", () => {
    const ranking = rank({
      computers: [computer(MINI)],
      copies: [copy("a", MINI), copy("b", MINI)],
      threads: [{ environmentId: MINI, workingCopyId: "b", updatedAt: CHECKED }],
    });
    expect(order(ranking)).toEqual(["mini:b", "mini:a"]);
  });

  it("settles full ties by label, then computer, then copy, whatever the input order", () => {
    const computers = [computer(STUDIO), computer(MINI), computer(BOOK)];
    const copies = [copy("z", MINI), copy("a", MINI)];
    const forward = rank({ computers, copies });
    const reversed = rank({ computers: computers.toReversed(), copies: copies.toReversed() });
    expect(order(forward)).toEqual(["mini:a", "mini:z", "book", "studio"]);
    expect(order(reversed)).toEqual(order(forward));
  });

  it("orders offline computers among themselves by the same rules", () => {
    const ranking = rank({
      computers: [computer(BOOK, { online: false }), computer(MINI, { online: false })],
      copies: [copy("mini-copy", MINI)],
    });
    expect(order(ranking)).toEqual(["mini:mini-copy", "book"]);
    expect(ranking.candidates[0]!.reasons).toEqual(["offline", "not checked"]);
  });
});

describe("libraryLaunchFreshness", () => {
  it("reads missing health as unknown rather than up to date", () => {
    expect(libraryLaunchFreshness(null, null)).toEqual({
      freshness: "unknown",
      behind: 0,
      changed: 0,
    });
  });

  it("reads an unreadable repository as unknown and a copy with no repositories as unknown", () => {
    expect(
      libraryLaunchFreshness(health("c", MINI, [repository({ error: "unreadable" })]), null)
        .freshness,
    ).toBe("unknown");
    expect(libraryLaunchFreshness(health("c", MINI, []), null).freshness).toBe("unknown");
  });

  it("treats a branch without an upstream as not behind", () => {
    const noUpstream = repository({ upstream: undefined, ahead: undefined, behind: undefined });
    expect(libraryLaunchFreshness(health("c", MINI, [noUpstream]), null).freshness).toBe(
      "up-to-date",
    );
  });

  it("sums behind and changed counts across repositories", () => {
    expect(
      libraryLaunchFreshness(
        health("c", MINI, [
          repository({ resourceId: "a", behind: 1, uncommittedFiles: 2 }),
          repository({ resourceId: "b", behind: 3 }),
        ]),
        null,
      ),
    ).toEqual({ freshness: "stale", behind: 4, changed: 2 });
  });
});
