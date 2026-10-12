import {
  CommandId,
  MessageId,
  ThreadId,
  type ProjectId,
  type RuntimeMode,
  type ProviderInteractionMode,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  WorkspaceHandoffError,
  type WorkspaceHandoffOffer,
  type WorkspaceHandoffPrepareInput,
  type WorkspaceHandoffFinishInput,
  type WorkspaceHandoffReceipt,
  type WorkspaceHandoffFinishResult,
} from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as CommandReceiptStore from "../../orchestration-v2/CommandReceiptStore.ts";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as Settings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as SourceControlRepository from "../../sourceControl/SourceControlRepositoryService.ts";
import * as ProjectLifecycle from "../project-lifecycle/ProjectLifecycleService.ts";
import { handoffContext, handoffThreadIdle, portableRemoteUrl } from "./policy.ts";

export class WorkspaceHandoffService extends Context.Service<
  WorkspaceHandoffService,
  {
    readonly offer: (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
    }) => Effect.Effect<WorkspaceHandoffOffer, WorkspaceHandoffError>;
    readonly prepare: (
      input: WorkspaceHandoffPrepareInput & {
        readonly runtimeMode?: RuntimeMode;
        readonly interactionMode?: ProviderInteractionMode;
      },
    ) => Effect.Effect<WorkspaceHandoffReceipt, WorkspaceHandoffError>;
    readonly finish: (
      input: WorkspaceHandoffFinishInput,
    ) => Effect.Effect<WorkspaceHandoffFinishResult, WorkspaceHandoffError>;
    readonly resume: (
      input: WorkspaceHandoffFinishInput,
    ) => Effect.Effect<WorkspaceHandoffReceipt, WorkspaceHandoffError>;
  }
>()("t3/fork/workspace-handoff/WorkspaceHandoffService") {}

const isHandoffError = Schema.is(WorkspaceHandoffError);
const stringify = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const projects = yield* ProjectService.ProjectService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const settings = yield* Settings.ServerSettingsService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const clones = yield* SourceControlRepository.SourceControlRepositoryService;
  const lanes = yield* ProjectLifecycle.ProjectLifecycleService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const locks = yield* KeyedLock.make<string>();
  const digest = (value: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(value))
      .pipe(
        Effect.map((bytes) =>
          Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
      );
  const command = (cwd: string, args: string[]) =>
    git.execute({ operation: "WorkspaceHandoff.git", cwd, args, allowNonZeroExit: true });
  const fail = (reason: WorkspaceHandoffError["reason"]) =>
    Effect.fail(new WorkspaceHandoffError({ reason }));
  const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>, reason: WorkspaceHandoffError["reason"]) =>
    effect.pipe(
      Effect.mapError((cause) =>
        isHandoffError(cause) ? cause : new WorkspaceHandoffError({ reason, cause }),
      ),
    );
  const projectFor = (id: ProjectId) =>
    projects
      .getById(id)
      .pipe(
        Effect.flatMap((project) =>
          Option.isNone(project) ? fail("unavailable") : Effect.succeed(project.value),
        ),
      );
  const shellFor = (id: ThreadId) =>
    projections
      .getThreadShell(id)
      .pipe(
        Effect.flatMap((shell) => (shell === null ? fail("unavailable") : Effect.succeed(shell))),
      );
  const sourceState = (shell: OrchestrationV2ThreadShell, head: string) =>
    stringify({
      head,
      threadId: shell.id,
      branch: shell.branch,
      worktreePath: shell.worktreePath,
      activity: [
        shell.latestUserMessageAt,
        shell.latestRunRequestedAt,
        shell.latestRunStartedAt,
        shell.latestRunCompletedAt,
      ].map((at) => (at == null ? null : DateTime.formatIso(at))),
      latestRunId: shell.latestRunId,
      title: shell.title,
    });
  const offer = Effect.fn("WorkspaceHandoff.offer")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: string;
  }) {
    const shell = yield* shellFor(input.threadId);
    if (!handoffThreadIdle(shell, yield* Clock.currentTimeMillis)) return yield* fail("busy");
    const project = yield* projectFor(shell.projectId);
    const cwd = shell.worktreePath ?? project.workspaceRoot;
    const status = yield* git.statusDetailsLocal(cwd);
    if (!status.isRepo || status.branch === null) return yield* fail("unavailable");
    const changes = yield* command(cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
    if (changes.exitCode !== 0) return yield* fail("unavailable");
    if (changes.stdout !== "" || changes.stdoutTruncated) return yield* fail("local-changes");
    const upstream = yield* command(cwd, ["rev-parse", "--verify", "@{upstream}"]);
    const remote = yield* command(cwd, ["config", "--get", `branch.${status.branch}.remote`]);
    if (upstream.exitCode !== 0 || remote.exitCode !== 0 || remote.stdout.trim() === ".")
      return yield* fail("unpublished");
    const mergeRef = yield* command(cwd, ["config", "--get", `branch.${status.branch}.merge`]);
    if (mergeRef.exitCode !== 0 || !mergeRef.stdout.trim().startsWith("refs/heads/"))
      return yield* fail("unpublished");
    const upstreamBranch = mergeRef.stdout.trim().slice("refs/heads/".length);
    const remoteName = remote.stdout.trim();
    const fetched = yield* command(cwd, ["fetch", "--prune", "--", remoteName]);
    if (fetched.exitCode !== 0) return yield* fail("unavailable");
    const head = (yield* git.resolveCommit({ cwd, revision: "HEAD" })).commitSha;
    const published = yield* command(cwd, ["merge-base", "--is-ancestor", head, "@{upstream}"]);
    if (published.exitCode !== 0) return yield* fail("unpublished");
    const url = yield* command(cwd, ["remote", "get-url", remoteName]);
    if (url.exitCode !== 0 || url.stdoutTruncated) return yield* fail("unavailable");
    const remoteUrl = portableRemoteUrl(url.stdout.trim());
    const snapshot = yield* threads.getThreadSnapshotWindow(input.threadId, {
      rowLimit: 100,
      userTurnLimit: 20,
    });
    const initial = yield* threads.getTimelinePage(input.threadId, { view: "messages", limit: 1 });
    const first = initial.items[0]?.item;
    const messages = snapshot.projection.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
    }));
    if (
      first &&
      (first.type === "user_message" || first.type === "assistant_message") &&
      !messages.some((message) => message.id === first.messageId)
    )
      messages.unshift({
        id: first.messageId,
        role: first.type === "user_message" ? "user" : "assistant",
        text: first.text,
      });
    const context = handoffContext(messages);
    const contextTruncated =
      context.contextTruncated ||
      (yield* threads.getMessageCount(input.threadId)) > messages.length;
    const current = yield* shellFor(input.threadId);
    const finalHead = yield* git.resolveCommit({ cwd, revision: "HEAD" });
    const finalStatus = yield* git.statusDetailsLocal(cwd);
    const finalChanges = yield* command(cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
    if (
      finalHead.commitSha !== head ||
      finalStatus.branch !== status.branch ||
      finalChanges.exitCode !== 0 ||
      finalChanges.stdout !== "" ||
      finalChanges.stdoutTruncated
    )
      return yield* fail("source-changed");
    if (
      !handoffThreadIdle(current, yield* Clock.currentTimeMillis) ||
      sourceState(current, head) !== sourceState(shell, head)
    )
      return yield* fail("source-changed");
    return {
      ...input,
      sourceEnvironmentId: yield* environment.getEnvironmentId,
      sourceThreadId: input.threadId,
      title: shell.title,
      branch: status.branch,
      upstreamBranch,
      remoteUrl,
      repositoryKey: normalizeGitRemoteUrl(remoteUrl),
      headSha: head,
      stateKey: yield* digest(
        stringify({
          state: sourceState(current, head),
          cwd,
          branch: status.branch,
          upstreamBranch,
          repositoryKey: normalizeGitRemoteUrl(remoteUrl),
        }),
      ),
      ...context,
      contextTruncated,
    } satisfies WorkspaceHandoffOffer;
  });
  const targetThreadId = (offer: WorkspaceHandoffOffer) =>
    ThreadId.make(`handoff-${offer.sourceEnvironmentId}-${offer.requestId}`);
  const verifyReceipt = (input: WorkspaceHandoffFinishInput) =>
    input.receipt.requestId === input.offer.requestId &&
    input.receipt.stateKey === input.offer.stateKey &&
    input.receipt.headSha === input.offer.headSha &&
    input.receipt.threadId === targetThreadId(input.offer) &&
    input.receipt.branch === `handoff/${input.offer.requestId}` &&
    input.receipt.destinationEnvironmentId !== input.offer.sourceEnvironmentId
      ? Effect.void
      : fail("invalid-receipt");

  const readyCommandId = (offer: WorkspaceHandoffOffer) =>
    CommandId.make(
      `handoff:${offer.sourceEnvironmentId}:${offer.requestId}:${offer.stateKey}:ready`,
    );
  const finishCommandId = (offer: WorkspaceHandoffOffer) =>
    CommandId.make(`handoff:${offer.requestId}:${offer.stateKey}:finish`);
  const messageIdFor = (offer: WorkspaceHandoffOffer) =>
    MessageId.make(`handoff:${offer.requestId}:message`);
  const wasAccepted = (commandId: CommandId, threadId: ThreadId, commandType: string) =>
    receipts
      .getByCommandId(commandId)
      .pipe(
        Effect.map(
          (receipt) =>
            Option.isSome(receipt) &&
            receipt.value.status === "accepted" &&
            receipt.value.threadId === threadId &&
            receipt.value.commandType === commandType,
        ),
      );

  const prepare = Effect.fn("WorkspaceHandoff.prepare")(function* (
    input: WorkspaceHandoffPrepareInput & {
      readonly runtimeMode?: RuntimeMode;
      readonly interactionMode?: ProviderInteractionMode;
    },
  ) {
    const { offer } = input;
    const destinationEnvironmentId = yield* environment.getEnvironmentId;
    if (destinationEnvironmentId === offer.sourceEnvironmentId)
      return yield* fail("invalid-receipt");
    const project = yield* projectFor(input.projectId);
    const branch = `handoff/${offer.requestId}`;
    const threadId = targetThreadId(offer);
    if (yield* wasAccepted(readyCommandId(offer), threadId, "thread.metadata.update")) {
      const current = yield* threads.getThreadRecords(threadId, ["messages"], {
        messageIds: [messageIdFor(offer)],
      });
      const worktreePath = current.thread.worktreePath;
      if (
        current.thread.projectId !== project.id ||
        current.thread.branch !== branch ||
        worktreePath === null
      )
        return yield* fail("invalid-receipt");
      if (!current.messages.some((message) => message.id === messageIdFor(offer))) {
        if (current.thread.archivedAt != null || current.thread.deletedAt != null)
          return yield* fail("unavailable");
        if (
          !(yield* fs.exists(worktreePath)) ||
          (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
            offer.headSha
        )
          return yield* fail("preparation-failed");
      }
      return {
        requestId: offer.requestId,
        stateKey: offer.stateKey,
        destinationEnvironmentId,
        projectId: project.id,
        threadId,
        branch,
        worktreePath,
        headSha: offer.headSha,
      } satisfies WorkspaceHandoffReceipt;
    }
    if (
      !(yield* fs.exists(project.workspaceRoot)) ||
      (yield* fs.readDirectory(project.workspaceRoot)).length === 0
    )
      yield* clones.cloneRepository({
        remoteUrl: offer.remoteUrl,
        destinationPath: project.workspaceRoot,
      });
    const origin = yield* command(project.workspaceRoot, ["remote", "get-url", "origin"]);
    if (
      origin.exitCode !== 0 ||
      normalizeGitRemoteUrl(portableRemoteUrl(origin.stdout.trim())) !== offer.repositoryKey
    )
      return yield* fail("repository-mismatch");
    const fetched = yield* command(project.workspaceRoot, ["fetch", "--prune", "origin"]);
    if (fetched.exitCode !== 0) return yield* fail("unavailable");
    const published = yield* command(project.workspaceRoot, [
      "merge-base",
      "--is-ancestor",
      offer.headSha,
      `refs/remotes/origin/${offer.upstreamBranch}`,
    ]);
    if (published.exitCode !== 0) return yield* fail("unpublished");
    const resolved = resolveProjectSettings(yield* settings.getSettings, project.id).settings;
    const launch = yield* launches.launch({
      commandId: CommandId.make(`handoff:${offer.requestId}:${offer.stateKey}:prepare`),
      threadId,
      projectId: project.id,
      title: offer.title,
      modelSelection: resolved.defaultModelSelection ?? resolved.textGenerationModelSelection,
      runtimeMode: input.runtimeMode ?? resolved.defaultRuntimeMode,
      interactionMode: input.interactionMode ?? "default",
      createdBy: "user",
      creationSource: "web",
      workspaceStrategy: {
        type: "worktree",
        baseRef: offer.headSha,
        branch,
        startFromOrigin: false,
      },
      waitForPreparation: true,
    });
    const prepared = yield* threads.getThreadRecords(launch.threadId, []);
    const worktreePath = prepared.thread.worktreePath;
    if (
      worktreePath === null ||
      prepared.thread.branch !== branch ||
      !(yield* fs.exists(worktreePath))
    )
      return yield* fail("preparation-failed");
    const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
    if (head.commitSha !== offer.headSha) return yield* fail("preparation-failed");
    const tracking = yield* command(worktreePath, [
      "branch",
      `--set-upstream-to=origin/${offer.upstreamBranch}`,
      branch,
    ]);
    if (tracking.exitCode !== 0) return yield* fail("preparation-failed");
    yield* threads.dispatch({
      type: "thread.metadata.update",
      commandId: readyCommandId(offer),
      threadId,
      expectedEmpty: true,
    });
    return {
      requestId: offer.requestId,
      stateKey: offer.stateKey,
      destinationEnvironmentId,
      projectId: project.id,
      threadId: launch.threadId,
      branch,
      worktreePath,
      headSha: head.commitSha,
    } satisfies WorkspaceHandoffReceipt;
  });
  const finish = Effect.fn("WorkspaceHandoff.finish")(function* (
    input: WorkspaceHandoffFinishInput,
  ) {
    yield* verifyReceipt(input);
    if ((yield* environment.getEnvironmentId) !== input.offer.sourceEnvironmentId)
      return yield* fail("invalid-receipt");
    // Settlement can trigger checkout cleanup before a lost response is retried.
    if (
      yield* wasAccepted(finishCommandId(input.offer), input.offer.sourceThreadId, "thread.settle")
    ) {
      const shell = yield* shellFor(input.offer.sourceThreadId);
      return shell.settledOverride === "settled"
        ? {
            sourceSettled: true,
            reason:
              "The original conversation is settled. Safe checkout cleanup follows this host's Storage settings.",
          }
        : {
            sourceSettled: false,
            reason: "The original thread was resumed after handoff and remains active.",
          };
    }
    const shell = yield* shellFor(input.offer.sourceThreadId);
    const current = yield* offer({
      threadId: input.offer.sourceThreadId,
      requestId: input.offer.requestId,
    });
    if (current.stateKey !== input.offer.stateKey) return yield* fail("source-changed");
    const project = yield* projectFor(shell.projectId);
    const lane = yield* lanes.currentBuildEnvironment(shell.worktreePath ?? project.workspaceRoot);
    if (lane !== null) {
      const data = path.join(lane.spacePath, "data");
      if ((yield* fs.exists(data)) && (yield* fs.readDirectory(data)).length > 0)
        return {
          sourceSettled: false,
          reason: "Local application data was kept. The original thread remains active.",
        };
    }
    const ignored = yield* command(shell.worktreePath ?? project.workspaceRoot, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]);
    if (ignored.exitCode !== 0) return yield* fail("unavailable");
    if (
      ignored.stdoutTruncated ||
      ignored.stdout.split("\0").some((file) => file !== "" && !/(^|\/)node_modules\/$/.test(file))
    )
      return {
        sourceSettled: false,
        reason: "Local files and configuration were kept. The original thread remains active.",
      };
    yield* threads.dispatch({
      type: "thread.settle",
      threadId: shell.id,
      commandId: finishCommandId(input.offer),
      snapshotAt: shell.updatedAt,
    });
    return {
      sourceSettled: true,
      reason:
        "The original conversation is settled. Safe checkout cleanup follows this host's Storage settings.",
    };
  });
  const resume = Effect.fn("WorkspaceHandoff.resume")(function* (
    input: WorkspaceHandoffFinishInput,
  ) {
    yield* verifyReceipt(input);
    if ((yield* environment.getEnvironmentId) !== input.receipt.destinationEnvironmentId)
      return yield* fail("invalid-receipt");
    if (
      !(yield* wasAccepted(
        readyCommandId(input.offer),
        input.receipt.threadId,
        "thread.metadata.update",
      ))
    )
      return yield* fail("invalid-receipt");
    const messageId = messageIdFor(input.offer);
    const current = yield* threads.getThreadRecords(input.receipt.threadId, ["messages"], {
      messageIds: [messageId],
    });
    if (
      current.thread.projectId !== input.receipt.projectId ||
      current.thread.worktreePath !== input.receipt.worktreePath ||
      current.thread.branch !== input.receipt.branch
    )
      return yield* fail("invalid-receipt");
    if (current.messages.some((message) => message.id === messageId)) return input.receipt;
    if (current.thread.archivedAt != null || current.thread.deletedAt != null)
      return yield* fail("unavailable");
    const head = yield* git.resolveCommit({ cwd: input.receipt.worktreePath, revision: "HEAD" });
    if (head.commitSha !== input.offer.headSha) return yield* fail("source-changed");
    yield* threads.sendToThread({
      projectId: input.receipt.projectId,
      threadId: input.receipt.threadId,
      commandId: CommandId.make(`handoff:${input.offer.requestId}:resume`),
      messageId,
      text: `Continue the work from [${input.offer.title}](t3-thread://v1/${input.offer.sourceThreadId}) on this machine. The original conversation remains on its host (${input.offer.sourceEnvironmentId}). Its full history and attachments stay there. This is a linked continuation, using published commit ${input.offer.headSha}.\n\nConversation context${input.offer.contextTruncated ? " (excerpt)" : ""}:\n${input.offer.context}`,
      attachments: [],
      mode: "auto",
      createdBy: "user",
      creationSource: "web",
    });
    return input.receipt;
  });
  return WorkspaceHandoffService.of({
    offer: (input) => wrap(offer(input), "unavailable"),
    prepare: (input) =>
      wrap(locks.withLock(input.offer.requestId, prepare(input)), "preparation-failed"),
    finish: (input) => wrap(finish(input), "source-changed"),
    resume: (input) =>
      wrap(locks.withLock(input.offer.requestId, resume(input)), "preparation-failed"),
  });
});
export const layer = Layer.effect(WorkspaceHandoffService, make);
