import { type ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ProjectLifecycle from "../fork/project-lifecycle/ProjectLifecycleService.ts";

const Receipt = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  sessionId: Schema.String,
  sourceCwd: Schema.String,
  worktreePath: Schema.String,
  branch: Schema.String,
  baseCommit: Schema.String,
  agentId: Schema.NullOr(Schema.String),
  completed: Schema.Boolean,
});
type Receipt = typeof Receipt.Type;
const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(Receipt));
const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(Receipt));

export interface ClaudeWorktreeOwner {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly projectId: ProjectId;
}

export class ClaudeWorktreeError extends Schema.TaggedError<ClaudeWorktreeError>()(
  "ClaudeWorktreeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Loom could not ${this.operation} the Claude worktree.`;
  }
}

const isClaudeWorktreeError = Schema.is(ClaudeWorktreeError);

export class ClaudeWorktreeService extends Context.Service<
  ClaudeWorktreeService,
  {
    readonly create: (
      input: ClaudeWorktreeOwner & { readonly cwd: string; readonly name: string },
    ) => Effect.Effect<Receipt, ClaudeWorktreeError>;
    readonly agentState: (
      input: ClaudeWorktreeOwner & {
        readonly cwd: string;
        readonly agentId: string;
        readonly completed: boolean;
      },
    ) => Effect.Effect<void, ClaudeWorktreeError>;
    readonly environment: (input: {
      readonly cwd: string | null;
      readonly path?: string | undefined;
    }) => Effect.Effect<Record<string, string>, ClaudeWorktreeError>;
    readonly describe: (
      input: ClaudeWorktreeOwner & { readonly cwd: string },
    ) => Effect.Effect<string | null, ClaudeWorktreeError>;
    readonly remove: (
      input: ClaudeWorktreeOwner & { readonly worktreePath: string },
    ) => Effect.Effect<"removed" | "retained" | "unowned", ClaudeWorktreeError>;
    readonly sweep: (
      input: ClaudeWorktreeOwner & { readonly cwd?: string },
    ) => Effect.Effect<void, ClaudeWorktreeError>;
  }
>()("t3/provider/ClaudeWorktreeService") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const config = yield* ServerConfig.ServerConfig;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const workflow = yield* GitWorkflowService.GitWorkflowService;
  const setupRunner = yield* Effect.serviceOption(
    ProjectSetupScriptRunner.ProjectSetupScriptRunner,
  );
  const lifecycle = yield* Effect.serviceOption(ProjectLifecycle.ProjectLifecycleService);
  const receiptsDirectory = path.join(config.stateDir, "claude-worktrees");
  const metadata = yield* Semaphore.make(1);
  const receipts = new Map<string, Receipt>();
  const removals = new Set<string>();
  let loaded = false;

  const load = Effect.fn("ClaudeWorktreeService.load")(function* () {
    if (loaded) return;
    yield* fs.makeDirectory(receiptsDirectory, { recursive: true });
    for (const name of yield* fs.readDirectory(receiptsDirectory)) {
      if (!name.endsWith(".json")) continue;
      const receipt = yield* fs
        .readFileString(path.join(receiptsDirectory, name))
        .pipe(Effect.flatMap(decodeReceipt));
      receipts.set(receipt.worktreePath, receipt);
    }
    loaded = true;
  });

  const save = Effect.fn("ClaudeWorktreeService.save")(function* (receipt: Receipt) {
    const file = path.join(receiptsDirectory, `${receipt.id}.json`);
    yield* fs.writeFileString(`${file}.tmp`, yield* encodeReceipt(receipt));
    yield* fs.rename(`${file}.tmp`, file);
    receipts.set(receipt.worktreePath, receipt);
  });

  const owns = (receipt: Receipt, owner: ClaudeWorktreeOwner) =>
    receipt.threadId === owner.threadId && receipt.sessionId === owner.sessionId;
  const inside = (root: string, cwd: string) => {
    const relative = path.relative(root, cwd);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  const find = (owner: ClaudeWorktreeOwner, cwd: string) =>
    [...receipts.values()].find(
      (receipt) => owns(receipt, owner) && inside(receipt.worktreePath, cwd),
    );
  const artifactsPath = (receipt: Receipt) => path.join(receiptsDirectory, receipt.id);

  const forgetReceipt = Effect.fn("ClaudeWorktreeService.forgetReceipt")(function* (
    receipt: Receipt,
  ) {
    if (Option.isSome(lifecycle))
      yield* lifecycle.value.releaseCheckout(ThreadId.make(receipt.threadId), receipt.worktreePath);
    yield* fs.remove(artifactsPath(receipt), { recursive: true, force: true });
    yield* fs.remove(path.join(receiptsDirectory, `${receipt.id}.json`), { force: true });
    receipts.delete(receipt.worktreePath);
  });

  const removeReceipt = Effect.fn("ClaudeWorktreeService.removeReceipt")(function* (
    receipt: Receipt,
  ) {
    if (removals.has(receipt.worktreePath)) return "retained" as const;
    removals.add(receipt.worktreePath);
    return yield* Effect.gen(function* () {
      const pathExists = yield* fs.exists(receipt.worktreePath);
      const branchExists = yield* git.execute({
        operation: "ClaudeWorktreeService.branchExists",
        cwd: receipt.sourceCwd,
        args: ["show-ref", "--verify", "--quiet", `refs/heads/${receipt.branch}`],
        allowNonZeroExit: true,
      });
      if (branchExists.exitCode !== 0) {
        if (pathExists || branchExists.exitCode !== 1) return "retained" as const;
        yield* forgetReceipt(receipt);
        return "removed" as const;
      }
      const branchCommit = yield* git.resolveCommit({
        cwd: receipt.sourceCwd,
        revision: `refs/heads/${receipt.branch}`,
      });
      const merged = yield* git.execute({
        operation: "ClaudeWorktreeService.merged",
        cwd: receipt.sourceCwd,
        args: ["merge-base", "--is-ancestor", branchCommit.commitSha, "HEAD"],
        allowNonZeroExit: true,
      });
      if (merged.exitCode !== 0) return "retained" as const;
      if (pathExists) {
        const status = yield* git.statusDetailsLocal(receipt.worktreePath);
        if (
          status.hasWorkingTreeChanges ||
          status.branch !== receipt.branch ||
          status.headSha !== branchCommit.commitSha
        )
          return "retained" as const;
        yield* workflow.removeWorktree({
          cwd: receipt.sourceCwd,
          path: receipt.worktreePath,
          force: false,
        });
      }
      yield* workflow.deleteLocalBranch({
        cwd: receipt.sourceCwd,
        refName: receipt.branch,
        force: false,
      });
      yield* forgetReceipt(receipt);
      return "removed" as const;
    }).pipe(Effect.ensuring(Effect.sync(() => removals.delete(receipt.worktreePath))));
  });

  const create = Effect.fn("ClaudeWorktreeService.create")(
    function* (input: ClaudeWorktreeOwner & { readonly cwd: string; readonly name: string }) {
      yield* metadata.withPermits(1)(load());
      const id = yield* random.uuidV4();
      const base = yield* git.resolveCommit({ cwd: input.cwd, revision: "HEAD" });
      const slug = input.name.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40) || "agent";
      const branch = `loom/claude-${slug}-${id.slice(0, 8)}`;
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const result = yield* restore(
            workflow.createWorktree({
              cwd: input.cwd,
              refName: base.commitSha,
              newRefName: branch,
              baseRefName: base.commitSha,
              path: null,
            }),
          );
          const receipt: Receipt = {
            id,
            threadId: input.threadId,
            sessionId: input.sessionId,
            sourceCwd: input.cwd,
            worktreePath: result.worktree.path,
            branch: result.worktree.refName,
            baseCommit: base.commitSha,
            agentId: null,
            completed: false,
          };
          yield* metadata.withPermits(1)(save(receipt));
          return yield* Effect.gen(function* () {
            yield* fs.makeDirectory(path.join(artifactsPath(receipt), "tmp"), { recursive: true });
            yield* fs.makeDirectory(path.join(artifactsPath(receipt), "build"), {
              recursive: true,
            });
            if (Option.isSome(lifecycle) && (yield* lifecycle.value.getSettings).enabled) {
              yield* restore(lifecycle.value.retainCheckout(input.threadId, receipt.worktreePath));
            }
            if (Option.isSome(setupRunner)) {
              const setup = yield* restore(
                setupRunner.value.runForThread({
                  threadId: input.threadId,
                  projectId: input.projectId,
                  projectCwd: input.cwd,
                  worktreePath: receipt.worktreePath,
                  terminalId: `claude-setup-${id}`,
                  observeCompletion: {},
                }),
              );
              if (setup.status === "started" && setup.completion !== undefined) {
                const completion = yield* restore(setup.completion);
                if (completion.exitCode !== 0)
                  return yield* new ClaudeWorktreeError({
                    operation: "prepare",
                    cause: completion,
                  });
              }
            }
            return receipt;
          }).pipe(
            Effect.onError(() =>
              metadata
                .withPermits(1)(save({ ...receipt, completed: true }))
                .pipe(Effect.ignore),
            ),
          );
        }),
      );
    },
    Effect.mapError((cause) =>
      isClaudeWorktreeError(cause)
        ? cause
        : new ClaudeWorktreeError({ operation: "create", cause }),
    ),
  );

  const agentState = Effect.fn("ClaudeWorktreeService.agentState")(
    function* (
      input: ClaudeWorktreeOwner & {
        readonly cwd: string;
        readonly agentId: string;
        readonly completed: boolean;
      },
    ) {
      yield* metadata.withPermits(1)(
        Effect.gen(function* () {
          yield* load();
          const receipt =
            [...receipts.values()].find(
              (candidate) => owns(candidate, input) && candidate.agentId === input.agentId,
            ) ?? find(input, input.cwd);
          if (
            receipt === undefined ||
            (receipt.agentId !== null && receipt.agentId !== input.agentId) ||
            (receipt.agentId === input.agentId && receipt.completed === input.completed)
          )
            return;
          yield* save({ ...receipt, agentId: input.agentId, completed: input.completed });
        }),
      );
    },
    Effect.mapError((cause) => new ClaudeWorktreeError({ operation: "track", cause })),
  );

  const environment = Effect.fn("ClaudeWorktreeService.environment")(
    function* (input: { readonly cwd: string | null; readonly path?: string | undefined }) {
      return Option.isSome(lifecycle)
        ? yield* lifecycle.value.shellEnvironment(input.cwd ?? "", input.path)
        : {};
    },
    Effect.mapError(
      (cause) => new ClaudeWorktreeError({ operation: "prepare environment for", cause }),
    ),
  );

  const describe = Effect.fn("ClaudeWorktreeService.describe")(
    function* (input: ClaudeWorktreeOwner & { readonly cwd: string }) {
      yield* metadata.withPermits(1)(load());
      const receipt = find(input, input.cwd);
      if (receipt === undefined) return null;
      const lane = Option.isSome(lifecycle)
        ? yield* lifecycle.value.currentBuildEnvironment(receipt.worktreePath)
        : null;
      const buildPath = lane?.buildPath ?? path.join(artifactsPath(receipt), "build");
      const tmpPath = lane?.tmpPath ?? path.join(artifactsPath(receipt), "tmp");
      return `Loom owns this isolated checkout: ${receipt.worktreePath}, branch ${receipt.branch}, based on parent HEAD ${receipt.baseCommit}. Build only in this checkout. Its build output is ${buildPath} and temporary directory is ${tmpPath}. Replace inherited parent TMPDIR/TMP/TEMP and LOOM_LANE_BUILD with these paths before building if the shell has not selected this checkout's lane. Use xcodebuild -derivedDataPath under this build directory, a checkout-specific Swift --scratch-path, and this checkout's node_modules and package caches. Commit and report this branch for one parent integration step. Retain the checkout until integration; Loom cleans up clean, merged branches after the parent finishes.`;
    },
    Effect.mapError((cause) => new ClaudeWorktreeError({ operation: "describe", cause })),
  );

  const remove = Effect.fn("ClaudeWorktreeService.remove")(
    function* (input: ClaudeWorktreeOwner & { readonly worktreePath: string }) {
      yield* metadata.withPermits(1)(load());
      const receipt = receipts.get(input.worktreePath);
      if (receipt === undefined || !owns(receipt, input)) return "unowned" as const;
      return yield* removeReceipt(receipt);
    },
    Effect.mapError((cause) => new ClaudeWorktreeError({ operation: "remove", cause })),
  );

  const sweep = Effect.fn("ClaudeWorktreeService.sweep")(
    function* (input: ClaudeWorktreeOwner & { readonly cwd?: string }) {
      yield* metadata.withPermits(1)(load());
      yield* Effect.forEach(
        [...receipts.values()].filter(
          (receipt) =>
            receipt.threadId === input.threadId &&
            receipt.completed &&
            (input.cwd === undefined || !inside(receipt.worktreePath, input.cwd)),
        ),
        (receipt) =>
          removeReceipt(receipt).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Loom kept a Claude worktree after cleanup failed", {
                worktreePath: receipt.worktreePath,
                cause,
              }),
            ),
          ),
        { discard: true },
      );
    },
    Effect.mapError((cause) => new ClaudeWorktreeError({ operation: "clean up", cause })),
  );

  return ClaudeWorktreeService.of({ create, agentState, environment, describe, remove, sweep });
});

export const layer = Layer.effect(ClaudeWorktreeService, make);
