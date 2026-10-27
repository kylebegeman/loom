import {
  CommandId,
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import {
  BRIEF_SUGGESTION_RUNS_PER_DAY,
  LibraryBriefSuggestion,
  LibraryError,
  type LibraryBriefProposal,
  type LibraryBriefProposalSource,
  type LibraryBriefSuggestionRequest,
  type LibraryProject,
  type LibraryProposeBriefRequest,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../../serverActivation.ts";
import * as LibraryPublisher from "./LibraryPublisher.ts";
import * as LibraryService from "./LibraryService.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";

const DAY_MILLIS = 24 * 60 * 60 * 1000;
const RUN_TITLE_MAX = 120;

/**
 * One suggestion and what its run needs. The settled thread's own model and permissions are
 * kept, so an offer accepted later starts the run the conversation would have started.
 */
const StoredSuggestion = Schema.Struct({
  suggestion: LibraryBriefSuggestion,
  launch: Schema.Struct({
    localProjectId: ProjectId,
    title: TrimmedNonEmptyString,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
  }),
});
type StoredSuggestion = typeof StoredSuggestion.Type;
const encodeStored = Schema.encodeEffect(Schema.fromJsonString(StoredSuggestion));
const decodeStored = Schema.decodeEffect(Schema.fromJsonString(StoredSuggestion));

/** The background conversation's only message: read, propose once or not at all, stop. */
export const briefSuggestionRunPrompt = (input: {
  readonly threadId: ThreadId;
  readonly project: LibraryProject;
}) =>
  [
    `A conversation in the Library project "${input.project.title}" just settled. Decide whether the project brief should change because of it.`,
    `Read that conversation with t3_thread_read (threadId ${input.threadId}). Do not read, create or change files, and do not run commands.`,
    `The current brief is revision ${input.project.revision} of project ${input.project.id}:`,
    `<brief>\n${input.project.brief}\n</brief>`,
    `If what the conversation did or learned should change the brief, call loom_library_brief_propose once with projectId ${input.project.id}, the full new brief, baseRevision ${input.project.revision} and a short summary of why. Otherwise do nothing. Then stop.`,
  ].join("\n\n");

/**
 * Brief suggestions when a conversation settles (LP-17). Each settled conversation bound to a
 * Library project whose setting asks for suggestions gets at most one, kept on this computer:
 * an offer a person starts, or a run started right away. A run is a separate background
 * conversation, so the settled one is never reopened or given another turn.
 */
export class LibraryBriefSuggestions extends Context.Service<
  LibraryBriefSuggestions,
  {
    /** Offers, starts or skips the suggestion for a conversation that settled. Once per thread. */
    readonly settled: (thread: OrchestrationV2AppThread) => Effect.Effect<void, LibraryError>;
    readonly suggestion: (
      input: LibraryBriefSuggestionRequest,
    ) => Effect.Effect<LibraryBriefSuggestion | null, LibraryError>;
    /** Starts an offered suggestion. */
    readonly start: (
      input: LibraryBriefSuggestionRequest,
    ) => Effect.Effect<LibraryBriefSuggestion, LibraryError>;
    readonly decline: (
      input: LibraryBriefSuggestionRequest,
    ) => Effect.Effect<LibraryBriefSuggestion, LibraryError>;
    /** Launches runs a restart interrupted after they were recorded. */
    readonly resume: Effect.Effect<void, LibraryError>;
    /**
     * Proposes a brief as the caller. A conversation proposes through the Library from this
     * computer; a suggestion run proposes once, as the conversation it read.
     */
    readonly propose: (
      input: LibraryProposeBriefRequest,
      source: LibraryBriefProposalSource,
    ) => Effect.Effect<LibraryBriefProposal, LibraryError>;
    /** Reads a project from the Library, from this computer or on the Library itself. */
    readonly project: (input: {
      readonly projectId: string;
    }) => Effect.Effect<LibraryProject, LibraryError>;
  }
>()("t3/fork/project-library/LibraryBriefSuggestions") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const publisher = yield* LibraryPublisher.LibraryPublisher;
  const library = yield* LibraryService.LibraryService;
  const workspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const lock = yield* Semaphore.make(1);
  const serviceScope = yield* Effect.scope;

  const io = (cause: unknown) => new LibraryError({ reason: "io", cause });
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const project = (input: { readonly projectId: string }) =>
    publisher.enabled ? publisher.project(input.projectId) : library.project(input);

  const decodeRow = (rows: ReadonlyArray<{ readonly payload_json: string }>) =>
    rows[0] === undefined ? Effect.succeed(null) : decodeStored(rows[0].payload_json);
  const read = (threadId: string) =>
    sql<{
      payload_json: string;
    }>`SELECT payload_json FROM fork_library_brief_suggestions WHERE thread_id=${threadId}`.pipe(
      Effect.flatMap(decodeRow),
      Effect.mapError(io),
    );
  /** The suggestion a background run belongs to, if `runThreadId` is one. */
  const readRun = (runThreadId: string) =>
    sql<{
      payload_json: string;
    }>`SELECT payload_json FROM fork_library_brief_suggestions WHERE run_thread_id=${runThreadId}`.pipe(
      Effect.flatMap(decodeRow),
      Effect.mapError(io),
    );
  /**
   * Saves a suggestion. `startedAt` counts it toward the daily limit; `null` stops counting it
   * and `"keep"` leaves the saved value.
   */
  const write = Effect.fnUntraced(function* (
    stored: StoredSuggestion,
    startedAt: string | null | "keep",
  ) {
    const { suggestion } = stored;
    const payload = yield* encodeStored(stored);
    const keep = startedAt === "keep" ? 1 : 0;
    const value = startedAt === "keep" ? null : startedAt;
    yield* sql`INSERT INTO fork_library_brief_suggestions (thread_id,project_id,run_thread_id,status,started_at,payload_json) VALUES (${suggestion.threadId},${suggestion.projectId},${suggestion.runThreadId ?? null},${suggestion.status},${value},${payload}) ON CONFLICT(thread_id) DO UPDATE SET run_thread_id=excluded.run_thread_id,status=excluded.status,started_at=CASE WHEN ${keep}=1 THEN fork_library_brief_suggestions.started_at ELSE excluded.started_at END,payload_json=excluded.payload_json`;
    return suggestion;
  }, Effect.mapError(io));
  const update = Effect.fnUntraced(function* (
    stored: StoredSuggestion,
    changes: Partial<LibraryBriefSuggestion>,
    startedAt: string | null | "keep",
  ) {
    return yield* write(
      { ...stored, suggestion: { ...stored.suggestion, ...changes, updatedAt: yield* nowIso } },
      startedAt,
    );
  });

  /** Runs started for a project on this computer in the last 24 hours. */
  const runsToday = Effect.fnUntraced(function* (projectId: string) {
    const since = DateTime.formatIso(
      DateTime.makeUnsafe((yield* Clock.currentTimeMillis) - DAY_MILLIS),
    );
    const rows = yield* sql<{
      runs: number;
    }>`SELECT COUNT(*) AS runs FROM fork_library_brief_suggestions WHERE project_id=${projectId} AND started_at IS NOT NULL AND started_at>=${since}`.pipe(
      Effect.mapError(io),
    );
    return Number(rows[0]?.runs ?? 0);
  });

  /** Launches a recorded run. The command id makes a repeat after a restart the same launch. */
  const launch = Effect.fnUntraced(function* (stored: StoredSuggestion, startedAt: string) {
    const { suggestion } = stored;
    const runThreadId = suggestion.runThreadId;
    if (runThreadId === undefined) return yield* new LibraryError({ reason: "invalid" });
    const launched = yield* Effect.gen(function* () {
      const current = yield* project({ projectId: suggestion.projectId });
      const resolved = yield* workspaces.getBinding(suggestion.threadId);
      const pinned = yield* workspaces.getBoundProject(suggestion.threadId);
      const source = yield* threads.getThreadShell(suggestion.threadId).pipe(Effect.mapError(io));
      if (
        current.archived ||
        resolved === null ||
        pinned === null ||
        source === null ||
        source.deletedAt != null ||
        source.projectId !== stored.launch.localProjectId ||
        resolved.localProjectId !== stored.launch.localProjectId ||
        resolved.binding.projectId !== suggestion.projectId ||
        pinned.id !== suggestion.projectId ||
        pinned.revision !== resolved.binding.projectRevision
      )
        return yield* new LibraryError({ reason: "blocked" });
      yield* workspaces.validateThreadCwd({
        threadId: suggestion.threadId,
        localProjectId: stored.launch.localProjectId,
        cwd: source.worktreePath ?? resolved.cwd,
      });
      // Provider startup requires a binding before its first turn. Keep the source's reviewed
      // copy, scope and cwd, including migrated worktrees, without inheriting its continuation.
      const { continuationOf: _continuationOf, ...binding } = resolved.binding;
      yield* workspaces.bind(runThreadId, { ...resolved, binding }, pinned);
      return yield* launches
        .launch({
          commandId: CommandId.make(`library-brief-suggestion:${suggestion.threadId}`),
          threadId: runThreadId,
          projectId: stored.launch.localProjectId,
          title: `Brief suggestion: ${stored.launch.title}`.slice(0, RUN_TITLE_MAX).trim(),
          modelSelection: stored.launch.modelSelection,
          runtimeMode: stored.launch.runtimeMode,
          // Plan mode asks for a plan to approve, so it would stop before proposing. The
          // prompt forbids edits instead.
          interactionMode: "default",
          workspaceStrategy:
            source.worktreePath == null
              ? { type: "root" }
              : { type: "existing_worktree", worktreePath: source.worktreePath },
          initialMessage: {
            text: briefSuggestionRunPrompt({ threadId: suggestion.threadId, project: current }),
            attachments: [],
          },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError(io));
    }).pipe(Effect.result);
    if (launched._tag === "Failure") {
      yield* Effect.logWarning("Brief suggestion run did not start", {
        threadId: suggestion.threadId,
        reason: launched.failure.reason,
      });
      return yield* update(stored, { status: "skipped", reason: "launch-failed" }, null);
    }
    // The run settles itself when it completes, so it leaves the active list. A run that
    // fails or waits on a person stays visible.
    const runId = launched.success.projection.runs.at(-1)?.id;
    if (runId !== undefined)
      yield* threads
        .settleAfterRun({
          projectId: stored.launch.localProjectId,
          threadId: launched.success.threadId,
          runId,
        })
        .pipe(Effect.ignore({ log: true }), Effect.forkIn(serviceScope));
    return yield* update(stored, { status: "started" }, startedAt);
  });

  /** Records the run before launching, then launches. Past the daily limit it only records why. */
  const begin = Effect.fnUntraced(function* (stored: StoredSuggestion) {
    if ((yield* runsToday(stored.suggestion.projectId)) >= BRIEF_SUGGESTION_RUNS_PER_DAY)
      return yield* update(stored, { status: "skipped", reason: "daily-limit" }, null);
    const startedAt = yield* nowIso;
    const starting: StoredSuggestion = {
      ...stored,
      suggestion: {
        ...stored.suggestion,
        status: "starting",
        runThreadId: ThreadId.make(`brief-suggestion-${stored.suggestion.threadId}`),
        updatedAt: startedAt,
      },
    };
    yield* write(starting, startedAt);
    return yield* launch(starting, startedAt);
  });

  const settled = Effect.fnUntraced(function* (thread: OrchestrationV2AppThread) {
    if ((yield* read(thread.id)) !== null || (yield* readRun(thread.id)) !== null) return;
    // Only conversations bound to a Library project.
    const resolved = yield* workspaces.getBinding(thread.id);
    if (resolved === null) return;
    const current = yield* project({ projectId: resolved.binding.projectId });
    const mode = current.profile?.briefSuggestions ?? "off";
    if (mode === "off" || current.archived) return;
    const now = yield* nowIso;
    const stored: StoredSuggestion = {
      suggestion: {
        threadId: thread.id,
        projectId: current.id,
        mode,
        settledAt: thread.settledAt === null ? now : DateTime.formatIso(thread.settledAt),
        status: "offered",
        updatedAt: now,
      },
      launch: {
        localProjectId: thread.projectId,
        title: thread.title,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
      },
    };
    if (mode === "automatic") return yield* begin(stored);
    // An offer the daily limit would refuse is skipped now rather than offered.
    if ((yield* runsToday(current.id)) >= BRIEF_SUGGESTION_RUNS_PER_DAY)
      return yield* write(
        {
          ...stored,
          suggestion: { ...stored.suggestion, status: "skipped", reason: "daily-limit" },
        },
        null,
      );
    return yield* write(stored, null);
  });

  const offered = Effect.fnUntraced(function* (threadId: string) {
    const stored = yield* read(threadId);
    if (stored === null) return yield* new LibraryError({ reason: "not-found" });
    if (stored.suggestion.status !== "offered")
      return yield* new LibraryError({ reason: "invalid" });
    return stored;
  });

  const resume = lock.withPermit(
    Effect.gen(function* () {
      const rows = yield* sql<{
        payload_json: string;
        started_at: string;
      }>`SELECT payload_json, started_at FROM fork_library_brief_suggestions WHERE status='starting'`.pipe(
        Effect.mapError(io),
      );
      for (const row of rows)
        yield* launch(
          yield* decodeStored(row.payload_json).pipe(Effect.mapError(io)),
          row.started_at,
        );
    }),
  );

  const forward = (input: LibraryProposeBriefRequest, source: LibraryBriefProposalSource) =>
    source.kind === "conversation" && publisher.enabled
      ? publisher.proposeBrief(input, source.threadId)
      : library.proposeBrief(input, source);

  const propose = Effect.fnUntraced(function* (
    input: LibraryProposeBriefRequest,
    source: LibraryBriefProposalSource,
  ) {
    const run = source.kind === "conversation" ? yield* readRun(source.threadId) : null;
    if (source.kind !== "conversation" || run === null) return yield* forward(input, source);
    if (run.suggestion.proposalId !== undefined || input.projectId !== run.suggestion.projectId)
      return yield* new LibraryError({ reason: "blocked" });
    const proposal = yield* forward(input, { ...source, threadId: run.suggestion.threadId });
    yield* update((yield* readRun(source.threadId)) ?? run, { proposalId: proposal.id }, "keep");
    return proposal;
  });

  return LibraryBriefSuggestions.of({
    settled: Effect.fn("LibraryBriefSuggestions.settled")(function (thread) {
      return lock.withPermit(settled(thread));
    }),
    suggestion: Effect.fn("LibraryBriefSuggestions.suggestion")(function (input) {
      return read(input.threadId).pipe(Effect.map((row) => row?.suggestion ?? null));
    }),
    start: Effect.fn("LibraryBriefSuggestions.start")(function (input) {
      return lock.withPermit(Effect.flatMap(offered(input.threadId), begin));
    }),
    decline: Effect.fn("LibraryBriefSuggestions.decline")(function (input) {
      return lock.withPermit(
        Effect.flatMap(offered(input.threadId), (stored) =>
          update(stored, { status: "declined" }, null),
        ),
      );
    }),
    resume,
    propose,
    project,
  });
});

export const layer = Layer.effect(LibraryBriefSuggestions, make);

/** Hands each settled conversation to the service and finishes launches a restart cut short. */
export const BriefSuggestionsReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const suggestions = yield* LibraryBriefSuggestions;
    const threads = yield* ThreadManagement.ThreadManagementService;
    yield* forkParked(
      Stream.runForEach(threads.streamDomainEvents, (event) =>
        event.type === "thread.settled"
          ? suggestions.settled(event.payload).pipe(Effect.ignore({ log: true }))
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Brief suggestion stream failed", { cause }),
        ),
      ),
    );
    yield* forkParked(suggestions.resume.pipe(Effect.ignore({ log: true })));
  }),
);
