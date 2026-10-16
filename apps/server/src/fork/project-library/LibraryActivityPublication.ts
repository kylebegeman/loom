import { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_ACTIVITY_FEATURE,
  LibraryActivity,
  LibraryError,
  type LibraryResolvedBinding,
  type LibraryTimelineMiniJob,
  type LibraryTimelineScheduledRun,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerActivation from "../../serverActivation.ts";
import * as MiniOffload from "../mini-offload/MiniOffloadService.ts";
import * as Publisher from "./LibraryPublisher.ts";
import type { WorkspaceReceipt } from "./LibraryWorkspaceStore.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";

/** How often a computer looks for finished work and publishes what the Library lacks. */
export const ACTIVITY_REPORT_INTERVAL = Duration.minutes(1);
/** How far back finished work is looked for, so a computer that was off catches up. */
const ACTIVITY_LOOKBACK_MS = Duration.toMillis(Duration.days(7));
/** Queued work older than this is dropped, published or not, so the queue stays small. */
const ACTIVITY_RETENTION_MS = Duration.toMillis(Duration.days(30));
const PUBLISH_BATCH_LIMIT = 50;
const SUMMARY_MAX = 160;

/** Finished work on this computer, before it is matched to a Library copy. */
export interface LibraryActivityCompletion {
  /** Stable for one completion, so seeing it again queues nothing. */
  readonly id: string;
  readonly at: string;
  readonly threadId: ThreadId | null;
  readonly localProjectId: ProjectId | null;
  readonly work:
    | { readonly kind: "scheduled-run"; readonly run: LibraryTimelineScheduledRun }
    | { readonly kind: "mini-job"; readonly job: LibraryTimelineMiniJob };
}

/** Reads finished scheduled runs and Mini jobs, so publication tests need neither. */
export class LibraryActivitySource extends Context.Service<
  LibraryActivitySource,
  {
    /** Work that finished at or after `sinceMs`. Never fails; unreadable sources give nothing. */
    readonly completions: (
      sinceMs: number,
    ) => Effect.Effect<ReadonlyArray<LibraryActivityCompletion>>;
  }
>()("t3/fork/project-library/LibraryActivityPublication/LibraryActivitySource") {}

const firstLine = (text: string | null, max: number) => {
  const line = text
    ?.split("\n")
    .find((part) => part.trim() !== "")
    ?.trim();
  return line ? line.slice(0, max) : undefined;
};

export const layerSource = Layer.effect(
  LibraryActivitySource,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const mini = yield* MiniOffload.MiniOffloadService;
    const threads = yield* ProjectionStore.ProjectionStoreV2;
    // Upstream owns scheduled tasks; this only reads their last finished run. A run's completion
    // writes `updated_at`, and runs at least a minute apart are each seen by the minute's poll.
    const scheduled = (since: string) =>
      sql<{
        task_id: string;
        title: string;
        project_id: string;
        thread_id: string | null;
        last_run_at: string;
        last_run_status: "succeeded" | "failed";
        updated_at: string;
      }>`SELECT task_id,title,project_id,thread_id,last_run_at,last_run_status,updated_at FROM scheduled_tasks WHERE last_run_status IN ('succeeded','failed') AND last_run_at IS NOT NULL AND updated_at >= ${since}`.pipe(
        Effect.map((rows) =>
          rows.map((row): LibraryActivityCompletion => ({
            id: `scheduled:${row.task_id}:${row.last_run_at}`,
            at: row.updated_at,
            threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
            localProjectId: ProjectId.make(row.project_id),
            work: {
              kind: "scheduled-run",
              // The prompt and error text stay on this computer.
              run: {
                taskId: row.task_id,
                title: row.title.trim().slice(0, 160),
                status: row.last_run_status,
                startedAt: row.last_run_at,
              },
            },
          })),
        ),
        Effect.orElseSucceed(() => []),
      );
    const jobs = (sinceMs: number) =>
      mini.finished(sinceMs).pipe(
        Effect.flatMap((finished) =>
          Effect.forEach(finished, ({ receipt, recordedAt }) =>
            Effect.gen(function* () {
              const job = receipt.job!;
              const threadId = receipt.request.threadId;
              const thread = yield* threads.getThread(threadId).pipe(Effect.option);
              const summary = firstLine(job.reason, SUMMARY_MAX);
              const workerName = receipt.workerName.trim().slice(0, 80);
              return {
                id: `mini:${receipt.request.requestId}`,
                at: recordedAt,
                threadId,
                localProjectId: thread._tag === "Some" ? thread.value.projectId : null,
                work: {
                  kind: "mini-job",
                  // The command line and logs stay on this computer.
                  job: {
                    requestId: receipt.request.requestId,
                    label: receipt.request.label.trim().slice(0, 80),
                    ...(workerName ? { workerName } : {}),
                    status: job.state as LibraryTimelineMiniJob["status"],
                    ...(job.exit_code === null ? {} : { exitCode: job.exit_code }),
                    ...(summary ? { summary } : {}),
                  },
                },
              } satisfies LibraryActivityCompletion;
            }),
          ),
        ),
        Effect.orElseSucceed(() => []),
      );
    return LibraryActivitySource.of({
      completions: (sinceMs) =>
        Effect.all([scheduled(DateTime.formatIso(DateTime.makeUnsafe(sinceMs))), jobs(sinceMs)], {
          concurrency: "unbounded",
        }).pipe(Effect.map(([runs, finished]) => [...runs, ...finished])),
    });
  }),
);

/**
 * The Library copy finished work ran in: the copy its thread is bound to, else the copy whose
 * root or repositories are its local project. Null for work outside every Library copy.
 */
export const activityCopy = (
  completion: Pick<LibraryActivityCompletion, "threadId" | "localProjectId">,
  receipts: ReadonlyArray<WorkspaceReceipt>,
  bindings: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly resolved: {
      readonly binding: Pick<LibraryResolvedBinding["binding"], "workingCopyId">;
    };
  }>,
) => {
  const bound = bindings.find((entry) => entry.threadId === completion.threadId);
  if (bound) {
    const copyId = bound.resolved.binding.workingCopyId;
    return receipts.some((receipt) => receipt.copy.id === copyId) ? copyId : null;
  }
  const projectId = completion.localProjectId;
  if (projectId === null) return null;
  const match = receipts.find(
    (receipt) =>
      receipt.rootLocalProjectId === projectId ||
      receipt.copy.rootLocalProjectId === projectId ||
      receipt.copy.repositories.some((repository) => repository.localProjectId === projectId),
  );
  return match?.copy.id ?? null;
};

const activityCodec = Schema.fromJsonString(LibraryActivity);
const encodeActivity = Schema.encodeEffect(activityCodec);
const decodeActivity = Schema.decodeEffect(activityCodec);
const isLibraryError = Schema.is(LibraryError);

/**
 * Publishes scheduled runs and Mini jobs that finished in Library copies to the Library timeline.
 * Each completion is queued once in `fork_library_source_activity`, then sent through the history
 * journal's authority fence with a request id derived from it, so a resend records nothing new. A
 * Library that is offline, or does not advertise `library-timeline-activity`, is tried again.
 */
export class LibraryActivityPublication extends Context.Service<
  LibraryActivityPublication,
  {
    /** Queues work that finished in a copy, then publishes what the Library has not taken. */
    readonly report: Effect.Effect<void, LibraryError>;
  }
>()("t3/fork/project-library/LibraryActivityPublication") {}

const make = Effect.gen(function* () {
  const publisher = yield* Publisher.LibraryPublisher;
  if (!publisher.enabled) return LibraryActivityPublication.of({ report: Effect.void });
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const workspaces = yield* WorkspaceStore.LibraryWorkspaceStore;
  const source = yield* LibraryActivitySource;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const lock = yield* Semaphore.make(1);

  const collect = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const completions = yield* source.completions(nowMs - ACTIVITY_LOOKBACK_MS);
    if (completions.length > 0) {
      const receipts = (yield* workspaces.receipts).filter(
        (receipt) =>
          receipt.copy.environmentId === environmentId && receipt.copy.registered !== false,
      );
      const bindings = yield* workspaces.bindings;
      for (const completion of completions) {
        const copyId = activityCopy(completion, receipts, bindings);
        if (copyId === null) continue;
        const payload = yield* encodeActivity({
          ...completion.work,
          id: completion.id,
          copyId,
          at: completion.at,
        } as LibraryActivity);
        yield* sql`INSERT INTO fork_library_source_activity (activity_id,payload_json,finished_at) VALUES (${completion.id},${payload},${completion.at}) ON CONFLICT(activity_id) DO NOTHING`;
      }
    }
    yield* sql`DELETE FROM fork_library_source_activity WHERE finished_at < ${DateTime.formatIso(DateTime.makeUnsafe(nowMs - ACTIVITY_RETENTION_MS))}`;
  });

  const publish = Effect.gen(function* () {
    const pending = yield* sql<{
      activity_id: string;
      payload_json: string;
    }>`SELECT activity_id,payload_json FROM fork_library_source_activity WHERE acknowledged=0 ORDER BY finished_at,activity_id LIMIT ${PUBLISH_BATCH_LIMIT}`;
    if (pending.length === 0) return;
    const info = yield* publisher.info;
    if (!info.features?.includes(LIBRARY_TIMELINE_ACTIVITY_FEATURE)) return;
    // History replication establishes the journal and its fence. Activity waits for it.
    const state = (yield* sql<{
      journal_id: string;
      environment_id: string;
      authority_id: string;
      authority_epoch: number;
    }>`SELECT journal_id,environment_id,authority_id,authority_epoch FROM fork_library_source_state WHERE key='host'`)[0];
    if (state === undefined) return;
    if (
      state.environment_id !== environmentId ||
      state.authority_id !== info.authorityId ||
      state.authority_epoch !== info.authorityEpoch
    )
      return yield* new LibraryError({ reason: "blocked" });
    // One refused entry, say for a copy the Library has not heard of yet, does not hold the rest.
    let failure: LibraryError | null = null;
    for (const row of pending) {
      const activity = yield* decodeActivity(row.payload_json);
      const digest = Hex.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(row.activity_id)),
      ).slice(0, 32);
      const result = yield* publisher
        .recordActivity({
          requestId: `${state.journal_id}:activity:${digest}`,
          authorityId: state.authority_id,
          authorityEpoch: state.authority_epoch,
          environmentId,
          activity,
        })
        .pipe(Effect.result);
      if (result._tag === "Failure") {
        failure ??= result.failure;
        if (result.failure.reason === "io" || result.failure.reason === "blocked") break;
        continue;
      }
      yield* sql`UPDATE fork_library_source_activity SET acknowledged=1 WHERE activity_id=${row.activity_id}`;
    }
    if (failure !== null) return yield* failure;
  });

  const report = lock.withPermit(
    Effect.gen(function* () {
      yield* collect;
      yield* publish;
    }).pipe(
      Effect.mapError((cause) =>
        isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
      ),
    ),
  );
  yield* ServerActivation.forkParked(
    report.pipe(Effect.ignore, Effect.repeat(Schedule.spaced(ACTIVITY_REPORT_INTERVAL))),
  );
  return LibraryActivityPublication.of({ report });
});

export const layer = Layer.effect(LibraryActivityPublication, make);
