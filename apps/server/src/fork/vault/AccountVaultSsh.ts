import type { ThreadId } from "@t3tools/contracts";
import {
  VaultConnectionError,
  VaultError,
  VaultSshError,
  type VaultConnectionPin,
  type VaultConnectionRequest,
  type VaultSshAgentFrame,
  type VaultSshAgentSession,
  type VaultSshRunInput,
  type VaultGitRunInput,
  type VaultSshResult,
  type VaultGitResult,
  type VaultWorkloadError,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as Client from "./AccountVaultClient.ts";
import * as SshTransport from "./SshTransport.ts";
import { isVaultRunRunning, readVaultThreadShell } from "./active-run.ts";

type FrameFailure = VaultError | VaultSshError;
type Failure = FrameFailure | VaultConnectionError | VaultWorkloadError;
const denied = () => new VaultError({ reason: "denied" });
const unavailable = () => new VaultError({ reason: "unavailable" });
export class AccountVaultSsh extends Context.Service<
  AccountVaultSsh,
  {
    readonly available: Effect.Effect<boolean, VaultError>;
    readonly open: (
      input: VaultConnectionRequest,
      threadId: ThreadId,
    ) => Effect.Effect<
      {
        session: VaultSshAgentSession;
        pin: VaultConnectionPin;
      },
      Failure
    >;
    readonly frame: (
      input: VaultSshAgentFrame,
      threadId: ThreadId,
    ) => Effect.Effect<{ response: string }, FrameFailure>;
    readonly close: (
      sessionId: string,
      threadId: ThreadId,
    ) => Effect.Effect<{ closed: true }, FrameFailure>;
    readonly sessions: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<VaultSshAgentSession>, FrameFailure>;
    readonly ssh: (
      input: VaultSshRunInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultSshResult, Failure>;
    readonly git: (
      input: VaultGitRunInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitResult, Failure>;
  }
>()("t3/fork/vault/AccountVaultSsh") {}
const make = Effect.gen(function* () {
  const client = yield* Client.AccountVaultClient;
  const transport = yield* SshTransport.SshTransport;
  const threads = yield* ThreadManagementService;
  const projects = yield* ProjectStoreV2;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const frame = Effect.fn("AccountVaultSsh.frame")(function* (
    input: VaultSshAgentFrame,
    threadId: ThreadId,
  ) {
    const result = yield* client.execute({ kind: "frame", input }, threadId);
    if (result.kind !== "frame") return yield* unavailable();
    return { response: result.response };
  });
  const close = Effect.fn("AccountVaultSsh.close")(function* (
    sessionId: string,
    threadId: ThreadId,
  ) {
    const result = yield* client.execute({ kind: "close", input: { sessionId } }, threadId);
    if (result.kind !== "close") return yield* unavailable();
    return { closed: true as const };
  });
  const open = Effect.fn("AccountVaultSsh.open")(function* (
    input: VaultConnectionRequest,
    threadId: ThreadId,
  ) {
    const resolution = yield* client.execute({ kind: "resolve", input }, threadId);
    if (resolution.kind !== "resolve") return yield* unavailable();
    const report = resolution.report;
    if (report.state !== "ready" || !report.selected)
      return yield* new VaultConnectionError({
        state: report.state,
        choices: report.choices,
        repair: report.repair,
      });
    const pin = report.selected;
    const result = yield* client.execute(
      {
        kind: "open",
        input: {
          ...input,
          connection: { id: pin.item.id, expectedVersion: pin.item.version },
        },
      },
      threadId,
    );
    if (
      result.kind !== "open" ||
      result.pin.item.id !== pin.item.id ||
      result.pin.item.version !== pin.item.version ||
      result.pin.destination !== pin.destination ||
      result.session.id !== pin.item.id ||
      result.session.version !== pin.item.version ||
      result.session.destination !== pin.destination ||
      result.session.target.hostKey === null
    )
      return yield* denied();
    return { pin: result.pin, session: result.session };
  });
  const liveThread = Effect.fn("AccountVaultSsh.liveThread")(function* (threadId: ThreadId) {
    const shell = yield* readVaultThreadShell(threads, threadId).pipe(Effect.mapError(denied));
    if (
      !shell ||
      shell.deletedAt !== null ||
      shell.archivedAt !== null ||
      shell.activeRunId === null
    )
      return yield* new VaultError({ reason: "denied", detail: "workload-inactive" });
    if (shell.runtimeMode !== "full-access" || shell.interactionMode !== "default")
      return yield* new VaultError({ reason: "denied", detail: "caller-permission" });
    if (!(yield* isVaultRunRunning(threads, shell)))
      return yield* new VaultError({ reason: "denied", detail: "workload-inactive" });
    return shell;
  });
  const run = Effect.fn("AccountVaultSsh.run")(function* (
    input: VaultSshRunInput | VaultGitRunInput,
    threadId: ThreadId,
  ) {
    const thread = yield* liveThread(threadId);
    const git = "repository" in input ? input : null;
    const selection =
      "connection" in input
        ? input.connection
        : {
            id: input.id,
            expectedVersion:
              "command" in input ? input.command.expectedVersion : input.expectedVersion,
          };
    const held = yield* Effect.acquireRelease(
      open(
        {
          kind: git ? "git-ssh" : "ssh",
          connection: selection,
          ...(git ? { repository: git.repository } : {}),
        },
        threadId,
      ),
      (held) => close(held.session.sessionId, threadId).pipe(Effect.ignore),
    );
    const authorize = Effect.gen(function* () {
      const current = yield* liveThread(threadId);
      if (
        current.activeRunId !== thread.activeRunId ||
        current.projectId !== thread.projectId ||
        current.providerInstanceId !== thread.providerInstanceId ||
        current.worktreePath !== thread.worktreePath ||
        held.session.expiresAt <= (yield* Clock.currentTimeMillis)
      )
        return yield* denied();
    });
    const project = git
      ? yield* projects.get(thread.projectId).pipe(Effect.mapError(denied))
      : null;
    if (project && Option.isNone(project)) return yield* denied();
    const cwd =
      project && Option.isSome(project) ? (thread.worktreePath ?? project.value.workspaceRoot) : "";
    if (git && (!cwd || !path.isAbsolute(cwd))) return yield* denied();
    const command = git
      ? {
          kind: "git" as const,
          expectedVersion: held.pin.item.version,
          action: git.action,
          repository: git.repository,
          cwd,
          timeoutMs: git.timeoutMs,
        }
      : "command" in input
        ? { ...input.command, expectedVersion: held.pin.item.version }
        : null;
    if (!command) return yield* denied();
    const requestId = (yield* random.uuidV4().pipe(Effect.mapError(unavailable))).replaceAll(
      "-",
      "",
    );
    const result = yield* transport.execute({
      target: held.session.target,
      publicKey: held.session.publicKey,
      command,
      authorize,
      agent: (input) => frame({ ...input, sessionId: held.session.sessionId }, threadId),
    });
    yield* authorize;
    return { sessionId: held.session.sessionId, requestId, ...result };
  }, Effect.scoped);
  return AccountVaultSsh.of({
    available: client.available,
    open,
    frame,
    close,
    sessions: Effect.fn("AccountVaultSsh.sessions")(function* (threadId) {
      const result = yield* client.execute({ kind: "sessions" }, threadId);
      if (result.kind !== "sessions") return yield* unavailable();
      return result.sessions;
    }),
    ssh: run,
    git: run,
  });
});
export const layer = Layer.effect(AccountVaultSsh, make);
