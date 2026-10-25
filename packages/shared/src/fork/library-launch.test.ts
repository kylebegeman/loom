import { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProfileReadiness,
  LibraryProjectProfile,
  LibraryRepositoryHealth,
  LibraryToolCheck,
  MiniWorkerReadiness,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryLaunchCandidateSummary,
  libraryLaunchFreshness,
  libraryLaunchMiniEligible,
  libraryLaunchReadiness,
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
  readiness?: readonly LibraryProfileReadiness[];
  profile?: Pick<LibraryProjectProfile, "allowMini" | "requiredTools">;
  miniWorkers?: readonly { environmentId: EnvironmentId; readiness: MiniWorkerReadiness }[];
}) =>
  rankLibraryLaunchCandidates({
    computers: input.computers,
    copies: input.copies ?? [],
    threads: input.threads ?? [],
    resourceIds: input.resourceIds ?? null,
    liveHealth: new Map((input.live ?? []).map((entry) => [entry.copyId, entry])),
    readiness: new Map((input.readiness ?? []).map((entry) => [entry.environmentId, entry])),
    profile: input.profile,
    miniWorkers: input.miniWorkers,
  });

const tool = (
  id: string,
  label: string,
  status: LibraryToolCheck["status"],
  extra: Partial<LibraryToolCheck> = {},
): LibraryToolCheck => ({ id, label, status, ...extra });

const checks = (
  environmentId: EnvironmentId,
  toolChecks: readonly LibraryToolCheck[],
): LibraryProfileReadiness => ({
  projectId: "project",
  environmentId,
  checks: toolChecks,
  secrets: [],
  checkedAt: CHECKED,
});

const worker = (overrides: Partial<MiniWorkerReadiness> = {}): MiniWorkerReadiness => ({
  workerId: "worker-1",
  name: "Build Mini",
  checkedAt: CHECKED,
  status: "ready",
  architecture: "arm64",
  cpuCount: 10,
  slots: 2,
  active: 0,
  nativeServerRunning: true,
  outputBundles: true,
  missingTools: [],
  reasons: [],
  ...overrides,
});

const order = (ranking: ReturnType<typeof rank>) =>
  ranking.candidates.map((candidate) =>
    candidate.kind === "copy"
      ? `${candidate.environmentId}:${candidate.copyId}`
      : candidate.kind === "mini"
        ? `mini:${candidate.workerId}`
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

  it("ranks up to date, then unchecked, then behind, then broken", () => {
    const ranking = rank({
      computers: [computer(MINI)],
      copies: [
        copy("broken", MINI),
        copy("behind", MINI),
        copy("unknown", MINI),
        copy("fresh", MINI),
      ],
      live: [
        health("broken", MINI, [repository({ error: "missing" })]),
        health("behind", MINI, [repository({ behind: 4 })]),
        health("fresh", MINI),
      ],
    });
    expect(order(ranking)).toEqual(["mini:fresh", "mini:unknown", "mini:behind", "mini:broken"]);
    expect(ranking.candidates.map((candidate) => candidate.reasons[1])).toEqual([
      "up to date",
      "not checked",
      "4 behind",
      "folder missing",
    ]);
  });

  it("keeps a copy with uncommitted files up to date, so it keeps its rank", () => {
    const ranking = rank({
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      threads: [{ environmentId: MINI, workingCopyId: "mini-copy", updatedAt: CHECKED }],
      live: [
        health("mini-copy", MINI, [repository({ uncommittedFiles: 4 })]),
        health("book-copy", BOOK),
      ],
    });
    expect(order(ranking)).toEqual(["mini:mini-copy", "book:book-copy"]);
    expect(ranking.candidates[0]).toMatchObject({ freshness: "up-to-date", changed: 4 });
    expect(ranking.candidates[0]!.reasons).toEqual(["online", "4 changed", "used last"]);
    expect(ranking.preselected).toMatchObject({ copyId: "mini-copy" });
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

describe("rankLibraryLaunchCandidates with required tools", () => {
  const XCODE_MISSING = tool("xcode", "Xcode", "missing");
  const GO_OLD = tool("go", "Go", "outdated", { version: "1.21", minimumVersion: "1.24" });
  const NODE_OK = tool("node", "Node.js", "ok", { version: "24.1.0" });
  const NODE_UNKNOWN = tool("node", "Node.js", "unknown");

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly computers: readonly LibraryLaunchComputer[];
    readonly copies?: readonly LibraryLaunchCopy[];
    readonly readiness: readonly LibraryProfileReadiness[];
    readonly order: readonly string[];
    readonly preselected: string | null;
  }> = [
    {
      name: "never preselects the best copy when its computer is missing a required tool",
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI)), copy("book-copy", BOOK)],
      readiness: [checks(MINI, [XCODE_MISSING]), checks(BOOK, [NODE_OK])],
      order: ["book:book-copy", "mini:mini-copy"],
      preselected: "book:book-copy",
    },
    {
      name: "prefers getting a copy on a ready computer over a copy where a tool is too old",
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI))],
      readiness: [checks(MINI, [GO_OLD])],
      order: ["book", "mini:mini-copy"],
      preselected: "book",
    },
    {
      name: "preselects nothing when every online computer is missing a tool",
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      readiness: [checks(MINI, [XCODE_MISSING]), checks(BOOK, [XCODE_MISSING])],
      order: ["mini:mini-copy", "book:book-copy"],
      preselected: null,
    },
    {
      name: "keeps today's order when no computer has checks",
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI)), copy("book-copy", BOOK)],
      readiness: [],
      order: ["mini:mini-copy", "book:book-copy"],
      preselected: "mini:mini-copy",
    },
    {
      name: "does not count checks that could not run as failing",
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI)), copy("book-copy", BOOK)],
      readiness: [checks(MINI, [NODE_UNKNOWN]), checks(BOOK, [NODE_OK])],
      order: ["mini:mini-copy", "book:book-copy"],
      preselected: "mini:mini-copy",
    },
    {
      name: "still lists an offline computer after a computer missing a tool",
      computers: [computer(MINI, { online: false }), computer(BOOK)],
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      readiness: [checks(BOOK, [XCODE_MISSING])],
      order: ["book:book-copy", "mini:mini-copy"],
      preselected: null,
    },
  ];

  it.each(cases)("$name", (testCase) => {
    const ranking = rank({
      computers: testCase.computers,
      copies: testCase.copies ?? [],
      readiness: testCase.readiness,
    });
    expect(order(ranking)).toEqual(testCase.order);
    const preselected = ranking.preselected
      ? order({ ...ranking, candidates: [ranking.preselected] })[0]
      : null;
    expect(preselected).toBe(testCase.preselected);
  });

  it("ignores checks filed under another computer", () => {
    const ranking = rankLibraryLaunchCandidates({
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI)), copy("book-copy", BOOK)],
      threads: [],
      resourceIds: null,
      readiness: new Map([[MINI, checks(BOOK, [XCODE_MISSING])]]),
    });
    expect(order(ranking)).toEqual(["mini:mini-copy", "book:book-copy"]);
    expect(ranking.candidates.every((candidate) => candidate.readiness === "unknown")).toBe(true);
  });

  it("says which tool is missing or too old", () => {
    const ranking = rank({
      computers: [computer(MINI), computer(BOOK)],
      copies: [copy("mini-copy", MINI, health("mini-copy", MINI))],
      readiness: [checks(MINI, [XCODE_MISSING, GO_OLD, NODE_OK])],
    });
    const mini = ranking.candidates.find((candidate) => candidate.environmentId === MINI)!;
    expect(mini.readiness).toBe("not-ready");
    expect(mini.toolProblems).toEqual(["Xcode missing", "Go 1.21 (needs 1.24)"]);
    expect(libraryLaunchCandidateSummary(mini)).toBe(
      "Mac Mini · online, up to date, Xcode missing, Go 1.21 (needs 1.24)",
    );
  });
});

describe("rankLibraryLaunchCandidates with Mini", () => {
  const ALLOWED = { allowMini: true } as const;

  const cases: ReadonlyArray<{
    readonly name: string;
    readonly profile?: Pick<LibraryProjectProfile, "allowMini" | "requiredTools">;
    readonly host?: LibraryLaunchComputer;
    readonly readiness?: Partial<MiniWorkerReadiness>;
    readonly offered: boolean;
  }> = [
    { name: "offers a ready worker the profile allows", profile: ALLOWED, offered: true },
    { name: "hides Mini when the profile says nothing", offered: false },
    {
      name: "hides Mini when the profile turns it off",
      profile: { allowMini: false },
      offered: false,
    },
    {
      name: "hides a busy worker",
      profile: ALLOWED,
      readiness: { status: "busy" },
      offered: false,
    },
    {
      name: "hides a worker that needs setup",
      profile: ALLOWED,
      readiness: { status: "needs_setup" },
      offered: false,
    },
    {
      name: "hides an unreachable worker",
      profile: ALLOWED,
      readiness: { status: "unreachable" },
      offered: false,
    },
    {
      name: "hides a worker missing a required tool",
      profile: { allowMini: true, requiredTools: [{ id: "node" }] },
      readiness: { missingTools: ["node"] },
      offered: false,
    },
    {
      name: "offers a worker missing only a tool the project does not require",
      profile: { allowMini: true, requiredTools: [{ id: "node" }] },
      readiness: { missingTools: ["docker"] },
      offered: true,
    },
    {
      name: "hides a worker whose computer is offline",
      profile: ALLOWED,
      host: computer(BOOK, { online: false }),
      offered: false,
    },
    {
      name: "hides a worker whose computer cannot run agents",
      profile: ALLOWED,
      host: computer(BOOK, { supportsExecution: false }),
      offered: false,
    },
  ];

  it.each(cases)("$name", (testCase) => {
    const ranking = rank({
      computers: [testCase.host ?? computer(BOOK), computer(STUDIO)],
      ...(testCase.profile ? { profile: testCase.profile } : {}),
      miniWorkers: [{ environmentId: BOOK, readiness: worker(testCase.readiness) }],
    });
    expect(ranking.candidates.some((candidate) => candidate.kind === "mini")).toBe(
      testCase.offered,
    );
    expect(ranking.preselected?.kind).not.toBe("mini");
  });

  it("lists Mini after every computer, says what it is for, and never preselects it", () => {
    const ranking = rank({
      computers: [computer(BOOK, { online: false })],
      profile: ALLOWED,
      miniWorkers: [
        { environmentId: BOOK, readiness: worker() },
        { environmentId: MINI, readiness: worker({ workerId: "elsewhere" }) },
      ],
    });
    expect(ranking.candidates.some((candidate) => candidate.kind === "mini")).toBe(false);

    const online = rank({
      computers: [computer(STUDIO, { online: false }), computer(BOOK)],
      profile: ALLOWED,
      miniWorkers: [{ environmentId: BOOK, readiness: worker({ slots: 2, active: 1 }) }],
    });
    expect(order(online)).toEqual(["book", "studio", "mini:worker-1"]);
    expect(online.preselected?.environmentId).toBe(BOOK);
    expect(libraryLaunchCandidateSummary(online.candidates.at(-1)!)).toBe(
      "Build Mini · for long jobs, from MacBook, 1 slot free",
    );
  });
});

describe("libraryLaunchReadiness", () => {
  it("reads no checks, or only checks that could not run, as unknown", () => {
    expect(libraryLaunchReadiness(null).readiness).toBe("unknown");
    expect(libraryLaunchReadiness(checks(MINI, [])).readiness).toBe("unknown");
    expect(
      libraryLaunchReadiness(checks(MINI, [tool("node", "Node.js", "unknown")])).readiness,
    ).toBe("unknown");
    expect(libraryLaunchReadiness(checks(MINI, [tool("node", "Node.js", "ok")])).readiness).toBe(
      "ready",
    );
  });
});

describe("libraryLaunchMiniEligible", () => {
  it("needs the profile to allow Mini", () => {
    expect(libraryLaunchMiniEligible(undefined, worker())).toBe(false);
    expect(libraryLaunchMiniEligible({ allowMini: true }, worker())).toBe(true);
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

  it("reads uncommitted files alone as up to date", () => {
    expect(
      libraryLaunchFreshness(health("c", MINI, [repository({ uncommittedFiles: 3 })]), null),
    ).toEqual({ freshness: "up-to-date", behind: 0, changed: 3 });
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
