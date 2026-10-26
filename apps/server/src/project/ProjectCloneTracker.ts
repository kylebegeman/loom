import { SourceControlProviderKind, SourceControlRepositoryInfo } from "@t3tools/contracts";
import type {
  ProjectCloneSnapshot,
  ProjectCloneStage,
  ProjectCloneStartInput,
  ProjectCloneStartResult,
} from "@t3tools/contracts";
import {
  IsoDateTime,
  OrchestrationDispatchCommandError,
  PROJECT_CLONE_DETAIL_MAX_LENGTH,
  ProjectId,
  PROJECT_CLONE_ERROR_MAX_LENGTH,
  SourceControlRepositoryError,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts"; // fork: file-placement
import * as SourceControlRepositoryService from "../sourceControl/SourceControlRepositoryService.ts";

export class ProjectCloneTracker extends Context.Service<
  ProjectCloneTracker,
  {
    readonly start: (
      input: ProjectCloneStartInput,
      hooks: ProjectCloneHooks,
    ) => Effect.Effect<
      ProjectCloneStartResult,
      SourceControlRepositoryError | OrchestrationDispatchCommandError
    >;
    /** Interrupts a running clone and deletes the partial checkout. */
    readonly cancel: (projectId: ProjectId) => Effect.Effect<boolean>;
    /** Clones restored after a restart have no hooks until a retry brings them. */
    readonly retry: (
      projectId: ProjectId,
      hooks?: ProjectCloneHooks,
    ) => Effect.Effect<boolean, SourceControlRepositoryError>;
    /** Stops tracking, interrupts any running clone and removes unfinished checkouts. */
    readonly discard: (projectId: ProjectId) => Effect.Effect<void>;
    readonly get: (projectId: ProjectId) => Effect.Effect<ProjectCloneSnapshot | null>;
    readonly stream: Stream.Stream<ReadonlyArray<ProjectCloneSnapshot>>;
  }
>()("t3/project/ProjectCloneTracker") {}

export interface ProjectCloneHooks {
  readonly createProject: (input: {
    readonly projectId: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, OrchestrationDispatchCommandError>;
  readonly onCloned: (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
  }) => Effect.Effect<void>;
}

const DONE_RETENTION = "30 seconds";
// Git prints nothing while a transfer waits on the network, and the kernel can
// take 15+ minutes to give up on a dead connection. Without this the banner
// keeps showing the last transfer speed as if data were still arriving.
const STALL_AFTER = "20 seconds";

function clampText(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const INTERRUPTED_ERROR =
  "The clone was interrupted when Loom stopped. Retry it or remove the project.";

/** Written while a clone has no finished checkout; the URL is the redacted one. */
const CloneReceipt = Schema.Struct({
  projectId: ProjectId,
  remoteUrl: Schema.String,
  destinationPath: Schema.String,
  repository: Schema.NullOr(SourceControlRepositoryInfo),
  startedAt: IsoDateTime,
});
const decodeCloneReceipt = Schema.decodeUnknownOption(Schema.fromJsonString(CloneReceipt));
const encodeCloneReceipt = Schema.encodeSync(Schema.fromJsonString(CloneReceipt));

interface TrackedClone {
  readonly snapshot: ProjectCloneSnapshot;
  readonly fiber: Fiber.Fiber<unknown, unknown> | null;
  readonly hooks: ProjectCloneHooks | null;
  readonly input: {
    /** What git is given; may carry credentials and never leaves the server. */
    readonly cloneUrl: string;
    readonly destinationPath: string;
    readonly repository: SourceControlRepositoryInfo | null;
  };
}

/** @public */
export const make = Effect.gen(function* () {
  const repositories = yield* SourceControlRepositoryService.SourceControlRepositoryService;
  const git = yield* GitVcsDriver.GitVcsDriver; // fork: file-placement
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const receiptsDir = path.join((yield* ServerConfig.ServerConfig).stateDir, "project-clones");
  const receiptPath = (projectId: ProjectId) =>
    path.join(receiptsDir, `${encodeURIComponent(projectId)}.json`);
  const writeReceipt = (receipt: typeof CloneReceipt.Type) =>
    fileSystem.makeDirectory(receiptsDir, { recursive: true }).pipe(
      Effect.andThen(
        fileSystem.writeFileString(
          `${receiptPath(receipt.projectId)}.tmp`,
          encodeCloneReceipt(receipt),
        ),
      ),
      Effect.andThen(
        fileSystem.rename(`${receiptPath(receipt.projectId)}.tmp`, receiptPath(receipt.projectId)),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("Clone receipt could not be written", { cause: String(cause) }),
      ),
    );
  const removeReceipt = (projectId: ProjectId) =>
    fileSystem.remove(receiptPath(projectId), { force: true }).pipe(Effect.ignore);
  const clones = yield* Ref.make(new Map<ProjectId, TrackedClone>());
  const changes = yield* PubSub.unbounded<ReadonlyArray<ProjectCloneSnapshot>>();
  const retentionFibers = new Map<ProjectId, Fiber.Fiber<unknown, never>>();
  let sequence = 0;
  const cloneScope = yield* Scope.make("parallel");
  yield* Effect.addFinalizer(() => Scope.close(cloneScope, Exit.void));
  // Serialize actions on the shared entry and directory so retries cannot race clones.
  const actionLock = yield* Semaphore.make(1);
  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) => actionLock.withPermits(1)(effect);

  const list = Ref.get(clones).pipe(
    Effect.map((current) => Array.from(current.values(), (tracked) => tracked.snapshot)),
  );
  const publish = list.pipe(Effect.flatMap((snapshots) => PubSub.publish(changes, snapshots)));

  const modify = (
    projectId: ProjectId,
    mutate: (tracked: TrackedClone) => TrackedClone,
  ): Effect.Effect<ProjectCloneSnapshot | null> =>
    Ref.modify(clones, (current) => {
      const existing = current.get(projectId);
      if (!existing) return [null, current] as const;
      const nextTracked = mutate(existing);
      const nextSnapshot = { ...nextTracked.snapshot, sequence: ++sequence };
      const next = new Map(current);
      next.set(projectId, { ...nextTracked, snapshot: nextSnapshot });
      return [nextSnapshot, next] as const;
    }).pipe(Effect.tap((snapshot) => (snapshot ? publish : Effect.void)));

  const clearRetention = (projectId: ProjectId) => {
    const fiber = retentionFibers.get(projectId);
    retentionFibers.delete(projectId);
    return fiber ? Fiber.interrupt(fiber).pipe(Effect.ignore) : Effect.void;
  };

  const remove = (projectId: ProjectId) =>
    Ref.update(clones, (current) => {
      if (!current.has(projectId)) return current;
      const next = new Map(current);
      next.delete(projectId);
      return next;
    }).pipe(Effect.andThen(publish));

  const scheduleRemoval = Effect.fn("ProjectCloneTracker.scheduleRemoval")(function* (
    projectId: ProjectId,
  ) {
    yield* clearRetention(projectId);
    const fiber = yield* remove(projectId).pipe(
      Effect.delay(DONE_RETENTION),
      Effect.ensuring(
        Effect.sync(() => {
          if (retentionFibers.get(projectId) === fiber) retentionFibers.delete(projectId);
        }),
      ),
      Effect.forkDetach,
    );
    retentionFibers.set(projectId, fiber);
  });

  const progress = (
    projectId: ProjectId,
    update: {
      readonly stage: ProjectCloneStage;
      readonly percent: number | null;
      readonly detail: string | null;
    },
  ) =>
    modify(projectId, (tracked) => ({
      ...tracked,
      snapshot: {
        ...tracked.snapshot,
        stage: update.stage,
        percent: update.percent,
        detail:
          update.detail === null ? null : clampText(update.detail, PROJECT_CLONE_DETAIL_MAX_LENGTH),
        stalled: false,
      },
    })).pipe(Effect.asVoid);

  const markStalled = (projectId: ProjectId) =>
    modify(projectId, (tracked) => ({
      ...tracked,
      snapshot: { ...tracked.snapshot, stalled: true },
    })).pipe(Effect.asVoid);

  /** Marks the clone stalled once, then waits for git to speak again. */
  const watchForStall = (projectId: ProjectId, pulses: Queue.Dequeue<void>) =>
    Queue.take(pulses).pipe(
      Effect.timeoutOption(STALL_AFTER),
      Effect.flatMap((pulse) =>
        Option.isSome(pulse)
          ? Effect.void
          : markStalled(projectId).pipe(Effect.andThen(Queue.take(pulses))),
      ),
      Effect.forever,
    );

  const finish = Effect.fn("ProjectCloneTracker.finish")(function* (
    projectId: ProjectId,
    phase: "done" | "failed" | "cancelled",
    error: string | null,
  ) {
    const endedAt = yield* nowIso;
    yield* modify(projectId, (tracked) => ({
      ...tracked,
      fiber: null,
      snapshot: {
        ...tracked.snapshot,
        phase,
        endedAt,
        percent: phase === "done" ? 100 : tracked.snapshot.percent,
        stalled: false,
        error: error === null ? null : clampText(error, PROJECT_CLONE_ERROR_MAX_LENGTH),
      },
    }));
    if (phase === "done") yield* scheduleRemoval(projectId);
  });

  const cloneWatchingForStall = Effect.fn("ProjectCloneTracker.cloneWatchingForStall")(function* (
    projectId: ProjectId,
    tracked: TrackedClone,
  ) {
    const pulses = yield* Queue.sliding<void>(1);
    yield* watchForStall(projectId, pulses).pipe(Effect.forkScoped);
    return yield* repositories.cloneRepository(
      { remoteUrl: tracked.input.cloneUrl, destinationPath: tracked.input.destinationPath },
      {
        onProgress: (update) =>
          Queue.offer(pulses, undefined).pipe(Effect.andThen(progress(projectId, update))),
        timeoutMs: null,
        // fork: file-placement: the project registered here is the clone's own, so only its row is exempt.
        allowReuseOf: tracked.input.destinationPath,
      },
    );
  }, Effect.scoped);

  /**
   * `onExit` records outcomes even on interruption; `matchCause` would be skipped.
   * Mark the clone done before the post-clone hook so a late Cancel cannot remove it.
   */
  const runClone = (projectId: ProjectId, tracked: TrackedClone) =>
    cloneWatchingForStall(projectId, tracked).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? finish(projectId, "done", null)
          : Cause.hasInterruptsOnly(exit.cause)
            ? finish(projectId, "cancelled", null)
            : finish(projectId, "failed", describeCloneFailure(exit.cause)),
      ),
      // A slow post-clone hook must not leave a finished clone looking interrupted after a restart.
      Effect.flatMap(() =>
        Effect.all(
          [
            (
              tracked.hooks?.onCloned({
                projectId,
                workspaceRoot: tracked.input.destinationPath,
              }) ?? Effect.void
            ).pipe(Effect.ignoreCause({ log: true })),
            Effect.uninterruptible(removeReceipt(projectId)),
          ],
          { concurrency: "unbounded", discard: true },
        ),
      ),
      Effect.ignoreCause(),
    );

  const launch = Effect.fn("ProjectCloneTracker.launch")(function* (projectId: ProjectId) {
    const current = yield* Ref.get(clones);
    const tracked = current.get(projectId);
    if (!tracked) return;
    const fiber = yield* runClone(projectId, tracked).pipe(Effect.forkIn(cloneScope));
    yield* Ref.update(clones, (map) => {
      const existing = map.get(projectId);
      if (!existing) return map;
      const next = new Map(map);
      next.set(projectId, { ...existing, fiber });
      return next;
    });
  });

  const start: ProjectCloneTracker["Service"]["start"] = Effect.fn("ProjectCloneTracker.start")(
    function* (input, hooks) {
      const prepared = yield* repositories.prepareClone(input, { title: input.title });
      if (prepared.reuse !== undefined) {
        const reused = {
          projectId: prepared.reuse.projectId ?? input.projectId,
          cwd: prepared.destinationPath,
          remoteUrl: prepared.remoteUrl,
          repository: prepared.repository,
          destinationPath: prepared.destinationPath,
          reused: true,
        };
        if (prepared.reuse.projectId !== null) return reused;
        yield* hooks.createProject({
          projectId: input.projectId,
          title: input.title,
          workspaceRoot: prepared.destinationPath,
          createdAt: input.createdAt,
        });
        yield* hooks
          .onCloned({ projectId: input.projectId, workspaceRoot: prepared.destinationPath })
          .pipe(Effect.ignoreCause({ log: true }));
        return reused;
      }
      const startedAt = yield* nowIso;
      const snapshot: ProjectCloneSnapshot = {
        projectId: input.projectId,
        remoteUrl: prepared.remoteUrl,
        destinationPath: prepared.destinationPath,
        repository: prepared.repository,
        phase: "running",
        stage: "connecting",
        percent: null,
        detail: null,
        stalled: false,
        error: null,
        startedAt,
        endedAt: null,
        sequence: ++sequence,
      };
      const claimed = yield* Ref.modify(clones, (current) => {
        const conflict = Array.from(current.values()).some(
          (tracked) =>
            tracked.snapshot.projectId === input.projectId ||
            tracked.input.destinationPath === prepared.destinationPath,
        );
        if (conflict) return [false, current] as const;
        const next = new Map(current);
        next.set(input.projectId, {
          snapshot,
          fiber: null,
          hooks,
          input: {
            cloneUrl: prepared.cloneUrl,
            destinationPath: prepared.destinationPath,
            repository: prepared.repository,
          },
        });
        return [true, next] as const;
      });
      // A folder the server claimed for this request is empty and nobody else knows it.
      const releaseClaimedFolder =
        prepared.claimed === true
          ? fileSystem.remove(prepared.destinationPath, { recursive: true }).pipe(Effect.ignore)
          : Effect.void;
      if (!claimed) {
        yield* releaseClaimedFolder;
        return yield* new SourceControlRepositoryError({
          operation: "cloneRepository",
          provider: input.provider ?? SourceControlProviderKind.make("unknown"),
          detail: "A clone into this destination is already in progress.",
        });
      }
      // Finish or release the claim despite disconnects; a claim without a fiber cannot be cancelled or retried.
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* clearRetention(input.projectId);
          // Register before creation so racing thread.create and project.delete see the clone.
          yield* hooks.createProject({
            projectId: input.projectId,
            title: input.title,
            workspaceRoot: prepared.destinationPath,
            createdAt: input.createdAt,
          });
          yield* writeReceipt({
            projectId: input.projectId,
            remoteUrl: prepared.remoteUrl,
            destinationPath: prepared.destinationPath,
            repository: prepared.repository,
            startedAt,
          });
          yield* publish;
          yield* launch(input.projectId);
        }).pipe(
          Effect.tapError(() => remove(input.projectId).pipe(Effect.andThen(releaseClaimedFolder))),
        ),
      );
      return {
        projectId: input.projectId,
        cwd: prepared.destinationPath,
        remoteUrl: prepared.remoteUrl,
        repository: prepared.repository,
        destinationPath: prepared.destinationPath,
        reused: false,
      };
    },
  );

  const get: ProjectCloneTracker["Service"]["get"] = (projectId) =>
    Ref.get(clones).pipe(Effect.map((current) => current.get(projectId)?.snapshot ?? null));

  const cancel: ProjectCloneTracker["Service"]["cancel"] = Effect.fn("ProjectCloneTracker.cancel")(
    function* (projectId) {
      const current = yield* Ref.get(clones);
      const tracked = current.get(projectId);
      if (!tracked || tracked.snapshot.phase !== "running" || !tracked.fiber) return false;
      // Finish cancellation despite disconnects to avoid dead fibers behind running snapshots.
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* Fiber.interrupt(tracked.fiber!);
          const after = yield* get(projectId);
          if (after?.phase === "done") return;
          if (after?.phase === "running") yield* finish(projectId, "cancelled", null);
          yield* repositories.discardClone(tracked.input.destinationPath).pipe(Effect.ignore);
        }),
      );
      return true;
    },
  );

  const retry: ProjectCloneTracker["Service"]["retry"] = Effect.fn("ProjectCloneTracker.retry")(
    function* (projectId, hooks) {
      const current = yield* Ref.get(clones);
      const tracked = current.get(projectId);
      if (
        !tracked ||
        (tracked.snapshot.phase !== "failed" && tracked.snapshot.phase !== "cancelled")
      ) {
        return false;
      }
      yield* repositories.discardClone(tracked.input.destinationPath);
      const startedAt = yield* nowIso;
      yield* modify(projectId, (entry) => ({
        ...entry,
        hooks: hooks ?? entry.hooks,
        snapshot: {
          ...entry.snapshot,
          phase: "running",
          stage: "connecting",
          percent: null,
          detail: null,
          stalled: false,
          error: null,
          startedAt,
          endedAt: null,
        },
      }));
      yield* launch(projectId);
      return true;
    },
  );

  const discard: ProjectCloneTracker["Service"]["discard"] = Effect.fn(
    "ProjectCloneTracker.discard",
  )(function* (projectId) {
    const current = yield* Ref.get(clones);
    const tracked = current.get(projectId);
    if (!tracked) return;
    if (tracked.fiber) yield* Fiber.interrupt(tracked.fiber);
    // Git may have finished while the interrupt was landing; the project
    // is going away either way, but a complete checkout is the user's.
    const after = yield* get(projectId);
    if (after?.phase !== "done") {
      yield* repositories.discardClone(tracked.input.destinationPath).pipe(Effect.ignore);
    }
    yield* removeReceipt(projectId);
    yield* clearRetention(projectId);
    yield* remove(projectId);
  });

  // fork: file-placement
  // HEAD resolves once git has fetched. A receipt can outlive such a clone, and Retry or Remove would delete it.
  const cloneFinished = (destinationPath: string) =>
    git
      .execute({
        operation: "ProjectCloneTracker.cloneFinished",
        cwd: destinationPath,
        args: ["--git-dir", ".git", "rev-parse", "--verify", "--quiet", "HEAD"],
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      })
      .pipe(
        Effect.map((result) => result.exitCode === 0),
        Effect.orElseSucceed(() => false),
      );

  // A receipt left by an earlier run means its clone never finished; a gone folder means its project went too.
  const restore = Effect.fn("ProjectCloneTracker.restore")(function* () {
    const entries = yield* fileSystem
      .readDirectory(receiptsDir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const endedAt = yield* nowIso;
    const restored = new Map<ProjectId, TrackedClone>();
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(receiptsDir, entry);
      const receipt = decodeCloneReceipt(
        yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => "")),
      );
      if (
        Option.isNone(receipt) ||
        !(yield* fileSystem
          .exists(receipt.value.destinationPath)
          .pipe(Effect.orElseSucceed(() => false))) ||
        (yield* cloneFinished(receipt.value.destinationPath)) // fork: file-placement
      ) {
        yield* fileSystem.remove(file, { force: true }).pipe(Effect.ignore);
        continue;
      }
      const { projectId, remoteUrl, destinationPath, repository, startedAt } = receipt.value;
      restored.set(projectId, {
        fiber: null,
        hooks: null,
        input: { cloneUrl: remoteUrl, destinationPath, repository },
        snapshot: {
          projectId,
          remoteUrl,
          destinationPath,
          repository,
          phase: "failed",
          stage: "connecting",
          percent: null,
          detail: null,
          stalled: false,
          error: INTERRUPTED_ERROR,
          startedAt,
          endedAt,
          sequence: ++sequence,
        },
      });
    }
    yield* Ref.set(clones, restored);
  });
  yield* restore();

  const stream: ProjectCloneTracker["Service"]["stream"] = Stream.callback<
    ReadonlyArray<ProjectCloneSnapshot>
  >(
    (mailbox) =>
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        Queue.offerUnsafe(mailbox, yield* list);
        yield* Stream.fromSubscription(subscription).pipe(
          Stream.runForEach((snapshots) =>
            Effect.sync(() => Queue.offerUnsafe(mailbox, snapshots)),
          ),
          Effect.forkScoped,
        );
      }),
    { bufferSize: 1, strategy: "sliding" },
  );

  return ProjectCloneTracker.of({
    start: (input, hooks) => locked(start(input, hooks)),
    cancel: (projectId) => locked(cancel(projectId)),
    retry: (projectId, hooks) => locked(retry(projectId, hooks)),
    discard: (projectId) => locked(discard(projectId)),
    get,
    stream,
  });
});

const isSourceControlRepositoryError = Schema.is(SourceControlRepositoryError);

/**
 * Every dispatch transport (WebSocket, HTTP) runs this before normalizing so no
 * client can start a thread on an empty tree, and no attachment copies are made
 * for a command that is about to be refused.
 */
export const rejectCommandsDuringClone = Effect.fn("ProjectCloneTracker.rejectCommandsDuringClone")(
  function* (
    tracker: ProjectCloneTracker["Service"],
    command: {
      readonly type: string;
      readonly projectId?: ProjectId;
      readonly bootstrap?: unknown;
    },
  ): Effect.fn.Return<void, OrchestrationDispatchCommandError> {
    const projectId =
      command.type === "thread.create"
        ? (command.projectId ?? null)
        : command.type === "thread.turn.start"
          ? bootstrapProjectId(command.bootstrap)
          : null;
    if (projectId === null) return;
    const clone = yield* tracker.get(projectId);
    if (clone === null || clone.phase === "done") return;
    return yield* new OrchestrationDispatchCommandError({
      message:
        clone.phase === "running"
          ? "The repository is still being cloned."
          : "The repository was not cloned. Retry the clone first.",
    });
  },
);

function bootstrapProjectId(bootstrap: unknown): ProjectId | null {
  if (typeof bootstrap !== "object" || bootstrap === null) return null;
  const createThread = (bootstrap as { createThread?: { projectId?: ProjectId } }).createThread;
  return createThread?.projectId ?? null;
}

function describeCloneFailure(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (isSourceControlRepositoryError(error)) return error.detail;
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The repository could not be cloned.";
}

export const layer = Layer.effect(ProjectCloneTracker, make);
