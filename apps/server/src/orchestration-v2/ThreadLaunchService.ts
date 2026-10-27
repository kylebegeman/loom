import { restoreManagedProjectCheckout } from "../workspace/ManagedProjectCheckout.ts"; // fork: project-lifecycle
import * as SetupMarker from "../workspace/setupMarker.ts"; // fork: project-lifecycle
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  CommandId,
  type ChatAttachment,
  type MessageId,
  type ModelSelection,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2ProviderThreadNativeMetadata,
  type OrchestrationV2ThreadProjection,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  ProjectId,
  type RunId,
  type RuntimeMode,
  type ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  buildTemporaryWorktreeBranchName,
  flattenTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  WORKTREE_BRANCH_PREFIX,
} from "@t3tools/shared/git";

import {
  LibraryError,
  type LibraryProject,
  type LibraryThreadBinding,
} from "@t3tools/contracts/fork"; // fork: library-projects
// fork: library-projects
import { ForkRuntime, withForkRuntime } from "../fork/ForkRuntime.ts";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";
import * as LibraryWorkspace from "../fork/project-library/LibraryWorkspace.ts";
import * as ProjectOperations from "../fork/project-library/ProjectOperations.ts";
import * as LibraryFolderGuard from "../fork/project-library/LibraryFolderGuard.ts"; // fork: library-projects
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as Orchestrator from "./Orchestrator.ts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as ThreadManagement from "./ThreadManagementService.ts";

export type ThreadLaunchWorkspaceStrategy =
  | { readonly type: "root"; readonly branch?: string | undefined }
  | {
      readonly type: "existing_worktree";
      readonly worktreePath: string;
      readonly branch?: string | undefined;
    }
  | {
      readonly type: "worktree";
      readonly baseRef: string;
      readonly branch?: string | undefined;
      readonly startFromOrigin?: boolean | undefined;
    };

export interface ThreadLaunchInitialMessage {
  readonly messageId?: MessageId;
  readonly scheduledTaskId?: ScheduledTaskId;
  readonly senderThreadId?: ThreadId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: import("@t3tools/contracts").OrchestrationMessageContext | undefined;
}

// fork: library-projects -- the initiating session owns the durable Library launch as well.
type LibraryLaunchCaller =
  | {
      readonly threadId: ThreadId;
      readonly providerInstanceId: import("@t3tools/contracts").ProviderInstanceId;
    }
  | { readonly sessionId: string };
type LibraryLaunchBinding = {
  readonly project: LibraryProject;
  readonly binding: LibraryThreadBinding;
  readonly cwd: string;
};

export interface ThreadLaunchInput {
  readonly libraryCaller?: LibraryLaunchCaller; // fork: library-projects
  readonly commandId: CommandId;
  readonly threadId?: ThreadId;
  readonly reuseExistingThread?: boolean;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly generateTitle?: boolean;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceStrategy: ThreadLaunchWorkspaceStrategy;
  /** Returns only after workspace setup succeeds; used before releasing another host. */
  readonly waitForPreparation?: boolean; // fork: workspace-handoff
  readonly initialMessage?: ThreadLaunchInitialMessage;
  readonly importedNativeThread?: {
    readonly ref: {
      readonly driver: ProviderDriverKind;
      readonly nativeId: string;
      readonly strength: "strong";
    };
    readonly metadata?: OrchestrationV2ProviderThreadNativeMetadata;
  };
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

type PreparationInput = Pick<
  ThreadLaunchInput,
  // fork: workspace-handoff
  "commandId" | "projectId" | "workspaceStrategy" | "initialMessage" | "waitForPreparation"
> & {
  readonly reusedWorktree?: { readonly baseRef: string };
};

export interface ThreadLaunchPreparationInput {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export interface ThreadLaunchResult {
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection;
  /** The launch's last write (the initial message, else the thread claim) was accepted before this call. */
  readonly resumed: boolean;
}

export class ThreadLaunchError extends Schema.TaggedError<ThreadLaunchError>()(
  "ThreadLaunchError",
  {
    operation: Schema.Literals([
      "resolve-project",
      "read-receipt",
      "generate-metadata",
      "provision-worktree",
      "run-setup-script",
      "create-thread",
      "update-thread",
      "dispatch-message",
      "release-run",
      "fail-run",
    ]),
    commandId: CommandId,
    projectId: ProjectId,
    threadId: Schema.optional(ThreadId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread launch ${this.commandId} failed during ${this.operation}.`;
  }
}

export class ThreadLaunchBaseRefError extends Schema.TaggedError<ThreadLaunchBaseRefError>()(
  "ThreadLaunchBaseRefError",
  {
    projectId: ProjectId,
    projectTitle: Schema.String,
    workspaceRoot: Schema.String,
    baseRef: Schema.String,
  },
) {
  override get message(): string {
    return `Base ref "${this.baseRef}" does not resolve to a commit in project "${this.projectTitle}" (${this.workspaceRoot}).`;
  }
}

export class ThreadLaunchService extends Context.Service<
  ThreadLaunchService,
  {
    // fork: library-projects -- direct batch/delegation dispatches share the launch preflight.
    readonly resolveLibraryBinding: (input: {
      readonly projectId: ProjectId;
      readonly workspaceStrategy: ThreadLaunchWorkspaceStrategy;
      readonly callerThreadId?: ThreadId;
    }) => Effect.Effect<LibraryLaunchBinding | null, LibraryError>;
    readonly bindLibraryThread: (
      threadId: ThreadId,
      launch: LibraryLaunchBinding,
    ) => Effect.Effect<void, LibraryError>;
    readonly launch: (
      input: ThreadLaunchInput,
    ) => Effect.Effect<
      ThreadLaunchResult,
      ThreadLaunchError | ThreadManagement.ThreadManagementProviderInstanceDisabledError
    >;
    /** Check before creation for early errors; launch otherwise accepts and reports base failures inside the thread. */
    readonly checkWorktreeBase: (
      input: Pick<ThreadLaunchInput, "projectId" | "workspaceStrategy">,
    ) => Effect.Effect<void, ThreadLaunchBaseRefError>;
    readonly retryPreparation: (
      input: ThreadLaunchPreparationInput,
    ) => Effect.Effect<
      Orchestrator.OrchestratorV2DispatchResult,
      | Orchestrator.OrchestratorV2Error
      | ThreadManagement.ThreadManagementProviderInstanceDisabledError
    >;
    readonly prepareRun: (input: ThreadLaunchPreparationInput) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ThreadLaunchService") {}

const isThreadLaunchError = Schema.is(ThreadLaunchError);
const isLibraryError = Schema.is(LibraryError); // fork: library-projects

function failureDetail(error: unknown): string {
  if (isThreadLaunchError(error)) {
    const cause = error.cause;
    // fork: library-projects -- a Library refusal already says why and what to do instead.
    if (isLibraryError(cause) && cause.reason === "blocked") return cause.message;
    const detail = cause instanceof Error ? cause.message : String(cause);
    return `Workspace preparation failed during ${error.operation.replaceAll("-", " ")}: ${detail}`;
  }
  return `Workspace preparation failed: ${error instanceof Error ? error.message : String(error)}`;
}

const make = Effect.gen(function* () {
  // fork: project-lifecycle
  const restorationServices =
    yield* Effect.context<Effect.Services<ReturnType<typeof restoreManagedProjectCheckout>>>();
  const projects = yield* ProjectService.ProjectService;
  const setupTracker = yield* WorktreeSetupTracker.WorktreeSetupTracker;
  const cloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
  const terminals = yield* TerminalManager.TerminalManager;
  const git = yield* GitWorkflow.GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const libraryStore = yield* Effect.serviceOption(LibraryWorkspaceStore.LibraryWorkspaceStore); // fork: library-projects
  const libraryFolders = yield* Effect.serviceOption(LibraryFolderGuard.LibraryFolderGuard); // fork: library-projects
  const preparationScope = yield* Scope.make("sequential");
  const scheduledLaunches = yield* Ref.make<ReadonlySet<CommandId>>(new Set());
  yield* Effect.addFinalizer(() => Scope.close(preparationScope, Exit.void));

  const mapError =
    (input: PreparationInput, operation: ThreadLaunchError["operation"], threadId?: ThreadId) =>
    (cause: unknown) =>
      new ThreadLaunchError({
        operation,
        commandId: input.commandId,
        projectId: input.projectId,
        ...(threadId === undefined ? {} : { threadId }),
        cause,
      });

  const readReceipt = (input: ThreadLaunchInput, commandId: CommandId) =>
    receipts
      .getByCommandId(commandId)
      .pipe(Effect.mapError(mapError(input, "read-receipt", input.threadId)));

  // fork: library-projects -- use local receipts and pinned scope, including while the Library is offline.
  const resolveLibraryBinding: ThreadLaunchService["Service"]["resolveLibraryBinding"] = Effect.fn(
    "ThreadLaunchService.resolveLibraryBinding",
  )(function* (input) {
    const missing = () =>
      new LibraryError({
        reason: "blocked",
        detail:
          "This Library project's files are not registered on this computer. Prepare or reopen its copy from the Library project, then retry.",
      });
    if (Option.isNone(libraryStore)) {
      if (input.projectId.startsWith("library-copy:")) return yield* missing();
      return null;
    }
    const store = libraryStore.value;
    const parent =
      input.callerThreadId === undefined ? null : yield* store.getBinding(input.callerThreadId);
    const inherited = parent?.localProjectId === input.projectId ? parent : null;
    const receipt =
      inherited !== null
        ? yield* store.get(inherited.binding.workingCopyId)
        : (yield* store.receipts).find(
            (row) =>
              (input.projectId.startsWith("library-copy:") || row.copy.ownership === "managed") &&
              (row.rootLocalProjectId === input.projectId ||
                row.copy.repositories.some((repo) => repo.localProjectId === input.projectId)),
          );
    if (!receipt) {
      if (input.projectId.startsWith("library-copy:")) return yield* missing();
      return null;
    }
    if (input.workspaceStrategy.type !== "root")
      return yield* new LibraryError({
        reason: "blocked",
        detail: LibraryFolderGuard.LIBRARY_FOLDER_CHANGE_REFUSAL,
      });
    const project =
      (inherited !== null && input.callerThreadId !== undefined
        ? yield* store.getBoundProject(input.callerThreadId)
        : null) ?? receipt.project;
    const binding = inherited?.binding ?? {
      projectId: receipt.copy.projectId,
      projectRevision: receipt.copy.projectRevision,
      environmentId: receipt.copy.environmentId,
      workingCopyId: receipt.copy.id,
      resourceIds:
        receipt.rootLocalProjectId === input.projectId
          ? []
          : receipt.copy.repositories
              .filter((repo) => repo.localProjectId === input.projectId)
              .map((repo) => repo.resourceId),
    };
    if ((yield* ForkRuntime) === undefined)
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "Library launch services are unavailable on this computer. Restart Loom, then retry.",
      });
    const resolved = yield* withForkRuntime(
      Effect.flatMap(LibraryWorkspace.LibraryWorkspace, (workspace) =>
        workspace.resolveBinding({ project, binding }),
      ),
    );
    const local = yield* projects
      .getById(input.projectId)
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
    if (
      resolved.localProjectId !== input.projectId ||
      Option.isNone(local) ||
      resolved.cwd !== local.value.workspaceRoot
    )
      return yield* new LibraryError({
        reason: "blocked",
        detail:
          "The Library copy no longer matches this project's folder. Reopen the copy from the Library project, then retry.",
      });
    return { project, binding, cwd: resolved.cwd };
  });
  // fork: library-projects -- deferred delegated runs cannot start before their binding is durable.
  const bindLibraryThread: ThreadLaunchService["Service"]["bindLibraryThread"] = Effect.fn(
    "ThreadLaunchService.bindLibraryThread",
  )(function* (threadId, launch) {
    yield* withForkRuntime(
      Effect.flatMap(LibraryWorkspace.LibraryWorkspace, (workspace) =>
        workspace.bindThread({ threadId, project: launch.project, binding: launch.binding }),
      ),
    );
  });

  const validateReusableThread = Effect.fn("ThreadLaunchService.validateReusableThread")(function* (
    input: ThreadLaunchInput,
    threadId: ThreadId,
  ) {
    const projection = yield* threads
      .getThreadRecords(threadId, ["runs"])
      .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
    if (
      projection.thread.projectId !== input.projectId ||
      projection.thread.archivedAt !== null ||
      projection.thread.deletedAt !== null ||
      (yield* threads
        .getMessageCount(threadId)
        .pipe(Effect.mapError(mapError(input, "update-thread", threadId)))) > 0 ||
      projection.runs.length > 0
    ) {
      return yield* mapError(
        input,
        "update-thread",
        threadId,
      )("Only an empty active thread in the target project can change workspace during launch.");
    }
  });

  const checkWorktreeBase: ThreadLaunchService["Service"]["checkWorktreeBase"] = Effect.fn(
    "ThreadLaunchService.checkWorktreeBase",
  )(function* (input) {
    const strategy = input.workspaceStrategy;
    // `:/text` is a commit search, which cannot be asked for a commit type.
    if (strategy.type !== "worktree" || strategy.baseRef.startsWith(":")) return;
    const { baseRef } = strategy;
    const unresolved = yield* Effect.gen(function* () {
      const project = Option.getOrUndefined(yield* projects.getById(input.projectId));
      if (project === undefined) return undefined;
      const cwd = project.workspaceRoot;
      // `git worktree add` reads `-` as the previous checkout.
      if (yield* git.hasCommit({ cwd, refName: baseRef === "-" ? "@{-1}" : baseRef }))
        return undefined;
      if (
        strategy.startFromOrigin === true &&
        (yield* git.resolveWorktreeBaseRemote({ cwd, refName: baseRef })) !== null
      )
        return undefined;
      // git worktree add accepts remote-tracking branches; let Git decide when any matching ref exists.
      if (yield* git.hasRefNamed({ cwd, refName: baseRef })) return undefined;
      return (yield* git.hasCommit({ cwd, refName: "HEAD" })) ? project : undefined;
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (unresolved !== undefined)
      return yield* new ThreadLaunchBaseRefError({
        projectId: unresolved.id,
        projectTitle: unresolved.title,
        workspaceRoot: unresolved.workspaceRoot,
        baseRef,
      });
  });

  const prepareInBackground = Effect.fn("ThreadLaunchService.prepareInBackground")(function* (
    input: PreparationInput,
    threadId: ThreadId,
    runId: RunId | null,
  ) {
    const project = yield* projects.getById(input.projectId).pipe(
      Effect.mapError(mapError(input, "resolve-project", threadId)),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(mapError(input, "resolve-project", threadId)("Project no longer exists.")),
          onSome: Effect.succeed,
        }),
      ),
    );

    const reused = input.reusedWorktree;
    const createdWorktree = input.workspaceStrategy.type === "worktree"; // fork: project-lifecycle
    let createdWorktreePath: string | null = null;
    let setupTerminalId: string | null = null;
    let workspaceRecorded = false;
    let runReleased = false;
    // Stop background renames before forgetting worktrees; completed renames record them again.
    let branchRename: Fiber.Fiber<unknown> | null = null;
    if (input.workspaceStrategy.type === "worktree") {
      yield* setupTracker.begin({
        threadId,
        branch: input.workspaceStrategy.branch ?? null,
        baseRef: input.workspaceStrategy.baseRef,
        stages: ["fetch", "checkout", "setup-script", "agent"],
        fiber: yield* Effect.fiber,
      });
    } else {
      // fork: project-lifecycle -- every workspace tracks its setup, not only reused worktrees.
      yield* setupTracker.begin({
        threadId,
        branch: input.workspaceStrategy.branch ?? null,
        baseRef: reused?.baseRef ?? null, // fork: project-lifecycle
        stages: ["setup-script", "agent"],
        fiber: yield* Effect.fiber,
      });
    }
    yield* Effect.gen(function* () {
      // fork: project-lifecycle
      yield* restoreManagedProjectCheckout(project.workspaceRoot).pipe(
        Effect.provide(restorationServices),
        Effect.mapError(mapError(input, "resolve-project", threadId)),
      );
      const initialMessage = input.initialMessage;
      const generateBranchNameFor = Effect.fn("ThreadLaunchService.generateBranchNameFor")(
        function* (cwd: string, message: ThreadLaunchInitialMessage) {
          const settings = resolveProjectSettings(
            yield* serverSettings.getSettings,
            input.projectId,
          ).settings;
          const modelSelection =
            settings.sourceControlWriterModelSelection === null
              ? settings.textGenerationModelSelection
              : ServerSettings.resolveSourceControlWriterModelSelection(
                  settings,
                  yield* providerRegistry.getProviders,
                  input.projectId,
                );
          return yield* textGeneration
            .generateBranchName({
              naming: {
                mode: settings.branchNamingMode,
                prefix: settings.branchNamePrefix,
                instructions: settings.branchNameInstructions,
              },
              cwd,
              message: message.text,
              attachments: message.attachments,
              ...(message.context ? { context: message.context } : {}),
              modelSelection,
            })
            .pipe(
              Effect.map((result) => ({
                branch: result.branch,
                exactName: settings.branchNamingMode === "custom",
              })),
            );
        },
      );

      const requestedBranch = input.workspaceStrategy.branch;
      let branch: string | null;
      if (input.workspaceStrategy.type === "worktree" && requestedBranch === undefined) {
        const uuid = yield* randomUuidV4;
        branch = buildTemporaryWorktreeBranchName(() => uuid.replaceAll("-", ""));
      } else {
        branch = requestedBranch ?? null;
      }
      let worktreePath =
        input.workspaceStrategy.type === "existing_worktree"
          ? input.workspaceStrategy.worktreePath
          : null;
      if (input.workspaceStrategy.type === "worktree") {
        // fork: library-projects -- the thread exists by now, also on a retry. Recording the
        // worktree on a Library-bound thread is refused only after the worktree and branch
        // exist, and that rejection never says why.
        if (Option.isSome(libraryFolders))
          yield* libraryFolders.value
            .assertMayLeaveFolder(threadId)
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId))); // fork: library-projects
        if (runId !== null) {
          yield* threads
            .dispatch({
              type: "prepared-run.progress",
              commandId: CommandId.make(`${input.commandId}:progress:worktree`),
              threadId,
              runId,
              phase: "worktree",
            })
            .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
        }
        let startRef = input.workspaceStrategy.baseRef;
        let baseRefName = input.workspaceStrategy.baseRef;
        const shouldFetch =
          input.workspaceStrategy.startFromOrigin === true &&
          (yield* git
            .resolveWorktreeBaseRemote({
              cwd: project.workspaceRoot,
              refName: input.workspaceStrategy.baseRef,
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)))) !== null;
        yield* setupTracker.stageStatus(threadId, "fetch", shouldFetch ? "running" : "skipped");
        if (shouldFetch) {
          const remoteBase = yield* git
            .fetchWorktreeBaseCommit({
              cwd: project.workspaceRoot,
              refName: input.workspaceStrategy.baseRef,
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
          if (remoteBase !== null) {
            startRef = remoteBase.commitSha;
            baseRefName = `refs/remotes/${remoteBase.remoteRefName}`;
          }
        }
        if (shouldFetch) yield* setupTracker.stageStatus(threadId, "fetch", "done");
        if (
          branch !== null &&
          isTemporaryWorktreeBranch(branch) &&
          (yield* git
            .hasCommit({
              cwd: project.workspaceRoot,
              refName: `refs/heads/${WORKTREE_BRANCH_PREFIX}`,
            })
            .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId))))
        ) {
          branch = flattenTemporaryWorktreeBranchName(branch);
        }
        yield* setupTracker.stageStatus(threadId, "checkout", "running");
        const worktree = yield* git
          .createWorktree(
            {
              cwd: project.workspaceRoot,
              refName: startRef,
              newRefName: branch!,
              baseRefName,
              path: null,
            },
            {
              progress: {
                onWorktreeClaimed: (path) =>
                  Effect.sync(() => {
                    createdWorktreePath = path;
                  }),
                onCheckoutProgress: (progress) =>
                  setupTracker.stage(threadId, "checkout", { percent: progress.percent }),
              },
            },
          )
          .pipe(Effect.mapError(mapError(input, "provision-worktree", threadId)));
        worktreePath = worktree.worktree.path;
        branch = worktree.worktree.refName;
        createdWorktreePath = worktreePath;
        yield* setupTracker.update(threadId, (snapshot) => ({ ...snapshot, worktreePath, branch }));
        yield* setupTracker.stageStatus(threadId, "checkout", "done");
      }

      // Do not rewrite reused worktrees; that could undo the original branch rename.
      if (reused === undefined) {
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`${input.commandId}:workspace`),
            threadId,
            branch,
            worktreePath,
          })
          .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
      }
      workspaceRecorded = true;

      if (
        reused === undefined &&
        worktreePath !== null &&
        branch !== null &&
        initialMessage !== undefined &&
        isTemporaryWorktreeBranch(branch)
      ) {
        const oldBranch = branch;
        const worktreeCwd = worktreePath;
        branchRename = yield* generateBranchNameFor(worktreeCwd, initialMessage).pipe(
          Effect.flatMap(({ branch: newBranch, exactName }) =>
            git.renameBranch({
              cwd: worktreeCwd,
              oldBranch,
              newBranch,
              ...(exactName ? { exactName: true } : {}),
            }),
          ),
          Effect.flatMap((renamed) =>
            Effect.gen(function* () {
              yield* threads
                .dispatch({
                  type: "thread.metadata.update",
                  commandId: CommandId.make(`${input.commandId}:branch-rename`),
                  threadId,
                  branch: renamed.branch,
                  worktreePath: worktreeCwd,
                  expectedBranch: oldBranch,
                  expectedWorktreePath: worktreeCwd,
                })
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Parent thread worktree branch update failed", {
                      threadId,
                      cause,
                    }),
                  ),
                );
              // Update parents first so children inherit names; reread each pass for newly updated descendants.
              const visited = new Set([threadId]);
              while (true) {
                const snapshot = yield* threads.getShellSnapshot();
                const sharing = [...snapshot.threads, ...snapshot.archivedThreads].filter(
                  (thread) =>
                    !visited.has(thread.id) &&
                    thread.worktreePath === worktreeCwd &&
                    thread.branch === oldBranch,
                );
                if (sharing.length === 0) break;
                for (const thread of sharing) {
                  visited.add(thread.id);
                  yield* threads
                    .dispatch({
                      type: "thread.metadata.update",
                      commandId: CommandId.make(`${input.commandId}:branch-rename:${thread.id}`),
                      threadId: thread.id,
                      branch: renamed.branch,
                      expectedBranch: oldBranch,
                      expectedWorktreePath: worktreeCwd,
                    })
                    .pipe(
                      Effect.catchCause((cause) =>
                        Effect.logWarning("Shared thread worktree branch update failed", {
                          threadId: thread.id,
                          cause,
                        }),
                      ),
                    );
                }
              }
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Thread worktree branch rename failed", {
              commandId: input.commandId,
              threadId,
              oldBranch,
              cause,
            }),
          ),
          Effect.forkIn(preparationScope),
        );
      }

      // fork: project-lifecycle -- main-checkout launches show their setup phase too.
      if (runId !== null) {
        yield* threads
          .dispatch({
            type: "prepared-run.progress",
            commandId: CommandId.make(`${input.commandId}:progress:setup`),
            threadId,
            runId,
            phase: "setup",
          })
          .pipe(Effect.mapError(mapError(input, "update-thread", threadId)));
      }
      yield* setupTracker.stageStatus(threadId, "setup-script", "running");
      const setupCwd = worktreePath ?? project.workspaceRoot;
      const rootSetupPending =
        setupCwd === project.workspaceRoot &&
        (yield* SetupMarker.exists(project.workspaceRoot).pipe(
          Effect.provide(restorationServices),
          Effect.mapError(mapError(input, "run-setup-script", threadId)),
        ));
      // Loom runs setup in the main checkout too (docs/user/project-settings.md). A restored
      // managed checkout's pending marker also makes the launch wait for it.
      const setup = yield* setupScripts // fork: project-lifecycle
        .runForThread({
          threadId,
          projectId: input.projectId,
          projectCwd: project.workspaceRoot,
          worktreePath: setupCwd, // fork: project-lifecycle
          observeCompletion: {
            onOutputLine: (line: string) => setupTracker.appendTail(threadId, "setup-script", line),
          },
          project: {
            id: project.id,
            workspaceRoot: project.workspaceRoot,
            scripts: project.scripts,
          },
        })
        .pipe(Effect.mapError(mapError(input, "run-setup-script", threadId)));

      let awaitAsyncSetup = Effect.void;
      if (setup.status === "started") {
        setupTerminalId = setup.terminalId;
        yield* setupTracker.update(threadId, (snapshot) => ({
          ...snapshot,
          setupScript: {
            name: setup.scriptName,
            command: setup.scriptCommand,
            terminalId: setup.terminalId,
          },
        }));
        if (setup.completion) {
          const awaitCompletion = Effect.gen(function* () {
            const completion = yield* setup.completion!;
            yield* setupTracker.stage(threadId, "setup-script", {
              status: completion.exitCode === 0 ? "done" : "failed",
              detail: `exited with ${completion.exitCode ?? "no exit code"}`,
            });
            // fork: workspace-handoff -- awaited and pending-root setup fail the launch.
            if (
              completion.exitCode !== 0 &&
              (!setup.async || input.waitForPreparation === true || rootSetupPending)
            )
              return yield* mapError(
                input,
                "run-setup-script",
                threadId,
              )(`Setup script exited with ${completion.exitCode ?? "no exit code"}.`);
          });
          // fork: workspace-handoff
          if (setup.async && input.waitForPreparation !== true && !rootSetupPending) {
            awaitAsyncSetup = awaitCompletion.pipe(
              Effect.catchCause((cause) =>
                setupTracker.stage(threadId, "setup-script", {
                  status: "failed",
                  detail: failureDetail(Cause.squash(cause)),
                }),
              ),
            );
          } else {
            yield* awaitCompletion;
          }
        } else {
          // fork: workspace-handoff
          if (input.waitForPreparation === true || rootSetupPending)
            return yield* mapError(
              input,
              "run-setup-script",
              threadId,
            )("Setup did not provide a completion result.");
          yield* setupTracker.stageStatus(threadId, "setup-script", "done");
        }
      } else {
        yield* setupTracker.stageStatus(threadId, "setup-script", "skipped");
      }
      // fork: project-lifecycle
      if (rootSetupPending)
        yield* SetupMarker.clear(project.workspaceRoot).pipe(
          Effect.provide(restorationServices),
          Effect.mapError(mapError(input, "run-setup-script", threadId)),
        );
      yield* setupTracker.markUncancellable(threadId);
      yield* setupTracker.stageStatus(threadId, "agent", "running");
      if (runId !== null) {
        yield* threads
          .dispatch({
            type: "prepared-run.release",
            commandId: CommandId.make(`${input.commandId}:release`),
            threadId,
            runId,
          })
          .pipe(
            Effect.mapError(mapError(input, "release-run", threadId)),
            Effect.tap(() =>
              Effect.sync(() => {
                runReleased = true;
              }),
            ),
            Effect.uninterruptible,
          );
      }
      yield* setupTracker.stageStatus(threadId, "agent", "done");
      yield* awaitAsyncSetup;
      yield* setupTracker.finish(threadId, "done");
    }).pipe(
      Effect.onError((cause) =>
        Effect.gen(function* () {
          const cancelled = Cause.hasInterruptsOnly(cause);
          yield* setupTracker.finish(
            threadId,
            cancelled ? "cancelled" : "failed",
            cancelled ? null : failureDetail(Cause.squash(cause)),
          );
          if (cancelled && setupTerminalId)
            yield* terminals
              .close({ threadId, terminalId: setupTerminalId, deleteHistory: true })
              .pipe(Effect.ignore);
          if (
            createdWorktree && // fork: project-lifecycle
            createdWorktreePath &&
            ((cancelled && !runReleased) || !workspaceRecorded)
          ) {
            if (branchRename !== null) yield* Fiber.interrupt(branchRename);
            const removedPath = createdWorktreePath;
            // Forget worktrees only after removal succeeds; failed removals must not reuse partially written checkouts.
            yield* git
              .removeWorktree({ cwd: project.workspaceRoot, path: removedPath, force: true })
              .pipe(
                Effect.andThen(
                  threads
                    .dispatch({
                      type: "thread.metadata.update",
                      commandId: CommandId.make(`${input.commandId}:cancel-workspace`),
                      threadId,
                      worktreePath: null,
                      branch: null,
                    })
                    .pipe(Effect.ignore),
                ),
                Effect.catchCause((removeCause) =>
                  Effect.logWarning("Failed to remove an abandoned thread worktree", {
                    commandId: input.commandId,
                    threadId,
                    path: removedPath,
                    cause: removeCause,
                  }),
                ),
              );
          }
        }),
      ),
    );
  });

  const failPreparedRun = (
    input: Pick<PreparationInput, "commandId">,
    threadId: ThreadId,
    runId: RunId | null,
    cause: unknown,
  ) =>
    runId === null
      ? Effect.logWarning("Thread workspace preparation failed", {
          commandId: input.commandId,
          threadId,
          cause,
        })
      : threads
          .dispatch({
            type: "prepared-run.fail",
            commandId: CommandId.make(`${input.commandId}:fail`),
            threadId,
            runId,
            failure: makeProviderFailure({
              cause,
              message: failureDetail(cause),
              class: "validation_error",
              retryable: false,
            }),
          })
          .pipe(
            Effect.catchCause((persistCause) =>
              Effect.logWarning("Failed to persist thread workspace preparation failure", {
                commandId: input.commandId,
                threadId,
                cause,
                persistCause,
              }),
            ),
          );

  const reservePreparation = (commandId: CommandId) =>
    Ref.modify(scheduledLaunches, (scheduled) => {
      if (scheduled.has(commandId)) return [false, scheduled] as const;
      const next = new Set(scheduled);
      next.add(commandId);
      return [true, next] as const;
    });

  const releasePreparation = (commandId: CommandId) =>
    Ref.update(scheduledLaunches, (scheduled) => {
      const next = new Set(scheduled);
      next.delete(commandId);
      return next;
    });

  const schedulePreparation = Effect.fn("ThreadLaunchService.schedulePreparation")(function* (
    input: PreparationInput,
    threadId: ThreadId,
    runId: RunId | null,
  ) {
    const preparation = Effect.gen(function* () {
      const prepare = prepareInBackground(input, threadId, runId);
      if (
        runId === null ||
        (input.workspaceStrategy.type !== "worktree" && input.reusedWorktree === undefined)
      ) {
        return yield* prepare;
      }
      // fork: workspace-handoff
      // A foreground launch surfaces these reads, so they share the setup error.
      const watchError = mapError(input, "run-setup-script", threadId);
      const afterSequence = yield* threads
        .getThreadEventSequence(threadId)
        .pipe(Effect.mapError(watchError));
      const projection = yield* threads
        .getThreadRecords(threadId, ["runs"])
        .pipe(Effect.mapError(watchError));
      if (projection.runs.find((run) => run.id === runId)?.status !== "preparing") return;
      const interruption = threads
        .streamStoredEventsFrom({ threadId, afterSequence, eventType: "run.updated" })
        .pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "run.updated" &&
              stored.event.payload.id === runId &&
              (stored.event.payload.status === "interrupted" ||
                stored.event.payload.status === "cancelled"),
          ),
          Stream.runHead,
          Effect.mapError(watchError), // fork: workspace-handoff
          Effect.flatMap((event) => (Option.isSome(event) ? Effect.interrupt : Effect.never)),
        );
      yield* Effect.raceFirst(prepare, interruption);
    }).pipe(
      // fork: workspace-handoff -- an awaited launch yields this; only background ones fork it.
      Effect.onError((cause) =>
        failPreparedRun(
          input,
          threadId,
          runId,
          Cause.hasInterruptsOnly(cause) ? "Worktree setup cancelled." : Cause.squash(cause),
        ),
      ),
      // fork: workspace-handoff -- Effect.ignoreCause moved to the background branch below.
      Effect.ensuring(releasePreparation(input.commandId)),
      // fork: workspace-handoff -- Effect.forkIn moved to the background branch below.
    );
    // fork: workspace-handoff
    if (input.waitForPreparation === true) yield* preparation;
    else yield* preparation.pipe(Effect.ignoreCause, Effect.forkIn(preparationScope));
  });

  const launch: ThreadLaunchService["Service"]["launch"] = Effect.fn("ThreadLaunchService.launch")(
    function* (request) {
      // Scratch has no Git repository. Normalize before folder allocation so
      // durable preparation and retries use the thread's own Scratch folder.
      const input: ThreadLaunchInput =
        request.workspaceStrategy.type === "worktree" &&
        (yield* managedFolders.isScratchProject(request.projectId))
          ? { ...request, workspaceStrategy: { type: "root" } }
          : request;
      yield* ProjectCloneTracker.rejectCommandsDuringClone(cloneTracker, {
        type: "thread.create",
        projectId: input.projectId,
      }).pipe(Effect.mapError(mapError(input, "resolve-project")));
      const project = yield* projects.getById(input.projectId).pipe(
        Effect.mapError(mapError(input, "resolve-project")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(mapError(input, "resolve-project")("Project not found.")),
            onSome: Effect.succeed,
          }),
        ),
      );
      if (input.reuseExistingThread === true && input.threadId === undefined) {
        return yield* mapError(
          input,
          "update-thread",
        )("Reusing an existing thread requires a thread id.");
      }

      // fork: library-projects -- refuse unsupported folders before thread or worktree creation.
      const libraryLaunch = yield* resolveLibraryBinding({
        projectId: input.projectId,
        workspaceStrategy: input.workspaceStrategy,
        ...(input.libraryCaller && "threadId" in input.libraryCaller
          ? { callerThreadId: input.libraryCaller.threadId }
          : {}),
      }).pipe(Effect.mapError(mapError(input, "resolve-project")));
      if (
        libraryLaunch !== null &&
        (input.libraryCaller === undefined || input.reuseExistingThread === true)
      )
        return yield* mapError(
          input,
          "create-thread",
        )(
          new LibraryError({
            reason: "blocked",
            detail:
              "Start a new Library conversation from an active agent turn or a signed-in client.",
          }),
        );
      const libraryOperationId =
        libraryLaunch === null
          ? null
          : yield* withForkRuntime(
              Effect.flatMap(ProjectOperations.ProjectOperations, (operations) =>
                operations.operationId(input.commandId, "launch"),
              ),
            ).pipe(Effect.mapError(mapError(input, "create-thread")));
      const createCommandId =
        libraryOperationId === null
          ? input.commandId
          : CommandId.make(`${libraryOperationId}:create`);
      const launchReceipt = yield* readReceipt(input, createCommandId);
      yield* threads.assertProviderInstanceEnabled({
        projectId: input.projectId,
        commandId: createCommandId, // fork: library-projects
        instanceId: input.modelSelection.instanceId,
      });
      return yield* Effect.gen(function* () {
        // Recover ids from accepted launch receipts before allocating; retries have no client id and new ids collide with receipts.
        const reusableLaunchReceipt =
          input.threadId === undefined &&
          Option.isSome(launchReceipt) &&
          launchReceipt.value.status === "accepted" &&
          launchReceipt.value.commandType === "thread.create"
            ? launchReceipt.value
            : undefined;
        const candidateThreadId =
          input.threadId ??
          reusableLaunchReceipt?.threadId ??
          (yield* ids.allocate
            .thread({ projectId: input.projectId })
            .pipe(Effect.mapError(mapError(input, "create-thread"))));

        if (reusableLaunchReceipt !== undefined) {
          const shell = yield* threads
            .getThreadShell(candidateThreadId)
            .pipe(Effect.mapError(mapError(input, "create-thread", candidateThreadId)));
          if (shell === null) {
            return yield* mapError(input, "create-thread", candidateThreadId)("Thread not found.");
          }
          if (shell.projectId !== input.projectId) {
            return yield* mapError(
              input,
              "resolve-project",
              candidateThreadId,
            )("Project identity changed.");
          }
        }

        if (input.reuseExistingThread === true && Option.isNone(launchReceipt)) {
          yield* validateReusableThread(input, candidateThreadId);
        }

        const workspaceStrategy: ThreadLaunchWorkspaceStrategy =
          // fork: library-projects
          libraryLaunch !== null
            ? {
                type: "existing_worktree",
                worktreePath: libraryLaunch.cwd,
                ...(input.workspaceStrategy.branch === undefined
                  ? {}
                  : { branch: input.workspaceStrategy.branch }),
              }
            : input.workspaceStrategy.type === "root" && Option.isNone(launchReceipt)
              ? Option.match(
                  yield* managedFolders
                    .folderForThread({
                      projectId: input.projectId,
                      threadId: candidateThreadId,
                      text: input.initialMessage?.text ?? input.title,
                    })
                    .pipe(
                      Effect.mapError(mapError(input, "provision-worktree", candidateThreadId)),
                    ),
                  {
                    onNone: () => input.workspaceStrategy,
                    onSome: (worktreePath) => ({ type: "existing_worktree", worktreePath }),
                  },
                )
              : input.workspaceStrategy;
        const initialBranch = workspaceStrategy.branch ?? null;
        const initialWorktreePath =
          workspaceStrategy.type === "existing_worktree" ? workspaceStrategy.worktreePath : null;
        const claimDispatch =
          input.reuseExistingThread === true
            ? threads.dispatch({
                type: "thread.metadata.update",
                commandId: input.commandId,
                threadId: candidateThreadId,
                expectedEmpty: true,
              })
            : threads.dispatch({
                type: "thread.create",
                commandId: input.commandId,
                threadId: candidateThreadId,
                projectId: input.projectId,
                title: input.title,
                modelSelection: input.modelSelection,
                runtimeMode: input.runtimeMode,
                interactionMode: input.interactionMode,
                branch: initialBranch,
                worktreePath: initialWorktreePath,
                ...(input.importedNativeThread === undefined
                  ? {}
                  : { importedNativeThread: input.importedNativeThread }),
                createdBy: input.createdBy,
                creationSource: input.creationSource,
              });
        // fork: library-projects -- the existing operation owns create/bind and its retry receipt.
        const libraryCaller = input.libraryCaller;
        const claimed =
          libraryLaunch !== null && libraryOperationId !== null && libraryCaller !== undefined
            ? yield* withForkRuntime(
                Effect.flatMap(ProjectOperations.ProjectOperations, (operations) => {
                  const request = {
                    kind: "launch" as const,
                    input: {
                      project: libraryLaunch.project,
                      binding: libraryLaunch.binding,
                      threadId: candidateThreadId,
                      title: input.title,
                      modelSelection: input.modelSelection,
                      runtimeMode: input.runtimeMode,
                      interactionMode: input.interactionMode,
                    },
                  };
                  return "threadId" in libraryCaller
                    ? operations.executeAgent(libraryOperationId, request, libraryCaller)
                    : operations.executeClient(
                        libraryOperationId,
                        request,
                        libraryCaller.sessionId,
                      );
                }),
              ).pipe(
                Effect.as(null),
                Effect.mapError(mapError(input, "create-thread", candidateThreadId)),
              )
            : yield* claimDispatch.pipe(
                Effect.mapError(
                  mapError(
                    input,
                    input.reuseExistingThread === true ? "update-thread" : "create-thread",
                    candidateThreadId,
                  ),
                ),
              );
        const threadId =
          // fork: library-projects -- a Library launch claims through its operation, so claimed is null.
          claimed?.storedEvents.find((stored) => stored.event.type.startsWith("thread."))?.event
            .threadId ?? candidateThreadId;
        if (project.id !== input.projectId) {
          return yield* mapError(input, "resolve-project", threadId)("Project identity changed.");
        }

        let runId: RunId | null = null;
        let messageWasAlreadyAccepted = false;
        if (input.initialMessage !== undefined) {
          const messageCommandId = CommandId.make(`${input.commandId}:initial-message`);
          const messageReceipt = yield* readReceipt(input, messageCommandId);
          messageWasAlreadyAccepted = Option.isSome(messageReceipt);
          const messageId =
            input.initialMessage.messageId ??
            (yield* ids.allocate
              .message({ threadId, ordinal: 1 })
              .pipe(Effect.mapError(mapError(input, "dispatch-message", threadId))));
          const dispatched = yield* threads
            .dispatch({
              type: "message.dispatch",
              commandId: messageCommandId,
              threadId,
              messageId,
              text: input.initialMessage.text,
              ...(input.initialMessage.scheduledTaskId === undefined
                ? {}
                : { scheduledTaskId: input.initialMessage.scheduledTaskId }),
              ...(input.initialMessage.senderThreadId === undefined
                ? {}
                : { senderThreadId: input.initialMessage.senderThreadId }),
              attachments: input.initialMessage.attachments,
              ...(input.initialMessage.context ? { context: input.initialMessage.context } : {}),
              ...(input.generateTitle === true ? { titleSeed: input.title } : {}),
              modelSelection: input.modelSelection,
              dispatchMode: { type: "defer_start", workspaceStrategy },
              createdBy: input.createdBy,
              creationSource: input.creationSource,
            })
            .pipe(Effect.mapError(mapError(input, "dispatch-message", threadId)));
          // A concurrent retry can read no receipt and still replay the dispatch.
          messageWasAlreadyAccepted ||= dispatched.replayed === true;
          const runCreated = dispatched.storedEvents.find(
            (stored) => stored.event.type === "run.created",
          );
          runId = runCreated?.event.type === "run.created" ? runCreated.event.payload.id : null;
          if (runId === null) {
            return yield* mapError(
              input,
              "dispatch-message",
              threadId,
            )("Initial message was accepted without a durable run.");
          }
        }

        const projection = yield* threads
          .getThreadProjection(threadId)
          .pipe(Effect.mapError(mapError(input, "create-thread", threadId)));
        const runIsPreparing =
          runId !== null &&
          projection.runs.some((run) => run.id === runId && run.status === "preparing");
        // fork: workspace-handoff -- an accepted create does not mean setup succeeded. Awaited
        // launches can retry setup only while the destination thread still has no work.
        const retryEmptyPreparation =
          input.waitForPreparation === true &&
          runId === null &&
          projection.messages.length === 0 &&
          projection.runs.length === 0;
        const shouldSchedule =
          runId === null ? Option.isNone(launchReceipt) || retryEmptyPreparation : runIsPreparing;
        const boundWorktreePath = projection.thread.worktreePath;
        const preparationStrategy: ThreadLaunchWorkspaceStrategy =
          Option.isSome(launchReceipt) &&
          (workspaceStrategy.type === "root" || retryEmptyPreparation) && // fork: workspace-handoff
          boundWorktreePath !== null
            ? {
                type: "existing_worktree",
                worktreePath: boundWorktreePath,
                branch: projection.thread.branch ?? undefined, // fork: workspace-handoff
              }
            : workspaceStrategy;
        if (shouldSchedule) {
          const ownsPreparation = yield* reservePreparation(input.commandId);
          if (ownsPreparation) {
            yield* Effect.gen(function* () {
              const preparationStillRequired =
                runId === null
                  ? true
                  : yield* threads.getThreadRecords(threadId, ["runs"], { runIds: [runId] }).pipe(
                      Effect.map((current) =>
                        current.runs.some((run) => run.id === runId && run.status === "preparing"),
                      ),
                      Effect.mapError(mapError(input, "update-thread", threadId)),
                    );
              if (preparationStillRequired) {
                yield* schedulePreparation(
                  {
                    ...input,
                    workspaceStrategy: preparationStrategy,
                    // fork: workspace-handoff -- a retried worktree keeps its recorded base.
                    ...(retryEmptyPreparation &&
                    Option.isSome(launchReceipt) &&
                    workspaceStrategy.type === "worktree" &&
                    boundWorktreePath !== null
                      ? { reusedWorktree: { baseRef: workspaceStrategy.baseRef } }
                      : {}),
                  },
                  threadId,
                  runId,
                );
              } else {
                yield* releasePreparation(input.commandId);
              }
            }).pipe(Effect.onError(() => releasePreparation(input.commandId)));
            // fork: workspace-handoff
          } else if (input.waitForPreparation === true) {
            return yield* mapError(
              input,
              "run-setup-script",
              threadId,
            )("Workspace preparation is already running. Retry after it finishes.");
          }
        }

        return {
          threadId,
          projection,
          // An attempt that failed after claiming the thread recorded nothing, so
          // only a repeat of the final write counts as resumed.
          resumed:
            input.initialMessage === undefined
              ? Option.isSome(launchReceipt) || claimed?.replayed === true // fork: library-projects
              : messageWasAlreadyAccepted,
        };
      });
    },
  );

  const prepareRun: ThreadLaunchService["Service"]["prepareRun"] = Effect.fn(
    "ThreadLaunchService.prepareRun",
  )(function* (input) {
    const scheduled = yield* Effect.gen(function* () {
      const projection = yield* threads.getThreadProjection(input.threadId);
      const run = projection.runs.find((candidate) => candidate.id === input.runId);
      const workspacePreparation = run?.workspacePreparation;
      if (run?.status !== "preparing" || workspacePreparation === undefined) return;
      // fork: library-projects -- recover a delegation interrupted between its accepted command and binding.
      if (
        projection.thread.lineage.parentThreadId !== null &&
        Option.isSome(libraryStore) &&
        (yield* libraryStore.value.getBinding(input.threadId)) === null
      ) {
        const binding = yield* resolveLibraryBinding({
          projectId: projection.thread.projectId,
          callerThreadId: projection.thread.lineage.parentThreadId,
          workspaceStrategy: workspacePreparation,
        });
        if (binding !== null) yield* bindLibraryThread(input.threadId, binding);
      }
      if (!(yield* reservePreparation(input.commandId))) return;
      yield* scheduleRunPreparation(input, projection, run, workspacePreparation).pipe(
        Effect.onError(() => releasePreparation(input.commandId)),
      );
    }).pipe(Effect.exit);
    if (Exit.isFailure(scheduled)) {
      yield* failPreparedRun(input, input.threadId, input.runId, Cause.squash(scheduled.cause));
    }
  });

  const retryPreparation: ThreadLaunchService["Service"]["retryPreparation"] = Effect.fn(
    "ThreadLaunchService.retryPreparation",
  )(function* (input) {
    const dispatched = yield* threads.dispatch({
      type: "prepared-run.retry",
      commandId: input.commandId,
      threadId: input.threadId,
      runId: input.runId,
    });
    yield* prepareRun(input);
    return dispatched;
  });

  const scheduleRunPreparation = (
    input: ThreadLaunchPreparationInput,
    projection: OrchestrationV2ThreadProjection,
    run: OrchestrationV2ThreadProjection["runs"][number],
    workspacePreparation: ThreadLaunchWorkspaceStrategy,
  ) => {
    const message = projection.messages.find((candidate) => candidate.id === run.userMessageId);
    const reuse =
      workspacePreparation.type === "worktree" &&
      projection.thread.worktreePath !== null &&
      projection.thread.branch !== null
        ? {
            strategy: {
              type: "existing_worktree" as const,
              worktreePath: projection.thread.worktreePath,
              branch: projection.thread.branch,
            },
            reusedWorktree: { baseRef: workspacePreparation.baseRef },
          }
        : null;
    return schedulePreparation(
      {
        commandId: input.commandId,
        projectId: projection.thread.projectId,
        workspaceStrategy: reuse?.strategy ?? workspacePreparation,
        ...(reuse === null ? {} : { reusedWorktree: reuse.reusedWorktree }),
        ...(message === undefined
          ? {}
          : {
              initialMessage: {
                text: message.text,
                attachments: message.attachments,
                ...(message.context ? { context: message.context } : {}),
              },
            }),
      },
      input.threadId,
      run.id,
    );
  };

  return ThreadLaunchService.of({
    resolveLibraryBinding,
    bindLibraryThread, // fork: library-projects
    launch,
    checkWorktreeBase,
    retryPreparation,
    prepareRun,
  });
});

export const layer = Layer.effect(ThreadLaunchService, make);
