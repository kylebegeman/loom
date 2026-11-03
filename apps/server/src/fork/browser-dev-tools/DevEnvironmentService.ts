import { type TerminalEvent } from "@t3tools/contracts";
import {
  DevEnvironmentError,
  type DevControl,
  type DevServerRun,
  type DevSnapshot,
  type DevStart,
  type DevTarget,
} from "@t3tools/contracts/fork";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ProjectionStoreV2 } from "../../orchestration-v2/ProjectionStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { PortDiscovery } from "../../preview/PortScanner.ts";
import { ProjectProfileService } from "../project-profiles/ProjectProfileService.ts";
import { appendOutput, candidatesFrom, commandLine } from "./servers.ts";

export class DevEnvironmentService extends Context.Service<
  DevEnvironmentService,
  {
    readonly snapshot: (input: DevTarget) => Effect.Effect<DevSnapshot, DevEnvironmentError>;
    readonly watch: (input: DevTarget) => Stream.Stream<DevSnapshot, DevEnvironmentError>;
    readonly start: (input: DevStart) => Effect.Effect<DevServerRun, DevEnvironmentError>;
    readonly control: (input: DevControl) => Effect.Effect<DevServerRun, DevEnvironmentError>;
  }
>()("t3/fork/browser-dev-tools/DevEnvironmentService") {}
const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      packageManager: Schema.optionalKey(Schema.String),
    }),
  ),
);
const active = (run: DevServerRun) => ["starting", "running", "ready"].includes(run.state);

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const projects = yield* ProjectStoreV2;
  const projections = yield* ProjectionStoreV2;
  const settings = yield* ServerSettingsService;
  const profiles = yield* ProjectProfileService;
  const terminals = yield* TerminalManager;
  const ports = yield* PortDiscovery;
  const crypto = yield* SecureRandom.SecureRandom;
  const platform = yield* HostProcess.Platform;
  const gate = yield* Semaphore.make(1);
  const changes = yield* SubscriptionRef.make(0);
  const runs = new Map<string, DevServerRun>();
  const scopes = new Map<string, Scope.Closeable>();
  const receipts = new Map<string, { fingerprint: string; runId: string }>();
  const notify = () => SubscriptionRef.update(changes, (revision) => revision + 1);
  const finishScope = Effect.fn("DevEnvironment.finishScope")(function* (runId: string) {
    const scope = scopes.get(runId);
    scopes.delete(runId);
    if (scope) yield* Scope.close(scope, Exit.void);
  });
  const workspace = Effect.fn("DevEnvironment.workspace")(function* (input: DevTarget) {
    const thread = yield* projections
      .getThreadShell(input.threadId)
      .pipe(
        Effect.mapError((cause) => new DevEnvironmentError({ reason: "thread-not-found", cause })),
      );
    if (!thread || thread.deletedAt)
      return yield* new DevEnvironmentError({ reason: "thread-not-found" });
    const project = yield* projects
      .get(thread.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new DevEnvironmentError({ reason: "checkout-unavailable", cause }),
        ),
      );
    if (Option.isNone(project))
      return yield* new DevEnvironmentError({ reason: "checkout-unavailable" });
    const root = yield* fs
      .realPath(thread.worktreePath ?? project.value.workspaceRoot)
      .pipe(
        Effect.mapError(
          (cause) => new DevEnvironmentError({ reason: "checkout-unavailable", cause }),
        ),
      );
    return { root, project: project.value };
  });
  const candidates = Effect.fn("DevEnvironment.candidates")(function* (input: DevTarget) {
    const { root, project } = yield* workspace(input);
    const config = yield* settings.getSettings.pipe(
      Effect.mapError(
        (cause) => new DevEnvironmentError({ reason: "checkout-unavailable", cause }),
      ),
    );
    const profile = yield* profiles
      .get(project.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new DevEnvironmentError({ reason: "checkout-unavailable", cause }),
        ),
      );
    const actions = resolveProjectScripts(config, {
      id: project.projectId,
      scripts: project.scripts,
    });
    const manifest = yield* fs.readFileString(`${root}/package.json`).pipe(
      Effect.flatMap(decodeManifest),
      Effect.orElseSucceed(
        () => ({}) as { scripts?: Record<string, unknown>; packageManager?: string },
      ),
    );
    let manager = manifest.packageManager?.split("@")[0];
    if (!["pnpm", "npm", "yarn", "bun"].includes(manager ?? "")) {
      manager = "npm";
      for (const [file, name] of [
        ["pnpm-lock.yaml", "pnpm"],
        ["bun.lock", "bun"],
        ["bun.lockb", "bun"],
        ["yarn.lock", "yarn"],
      ] as const) {
        if (
          yield* fs
            .exists(`${root}/${file}`)
            .pipe(
              Effect.mapError(
                (cause) => new DevEnvironmentError({ reason: "checkout-unavailable", cause }),
              ),
            )
        ) {
          manager = name;
          break;
        }
      }
    }
    const dev = profile.commands.dev;
    return {
      root,
      candidates: candidatesFrom({
        actions,
        scripts: manifest.scripts ?? {},
        packageManager: manager!,
        ...(dev
          ? {
              mappedDev:
                dev._tag === "command"
                  ? dev.command
                  : actions.find((entry) => entry.id === dev.scriptId)?.command,
            }
          : {}),
      }),
    };
  });
  const snapshot = Effect.fn("DevEnvironment.snapshot")(function* (
    input: DevTarget,
  ): Effect.fn.Return<DevSnapshot, DevEnvironmentError> {
    const context = yield* candidates(input);
    return {
      ...context,
      runs: [...runs.values()].filter((run) => run.root === context.root).toReversed(),
    };
  });
  const remember = (request: string, fingerprint: string, runId: string) => {
    if (receipts.size >= 2000) receipts.delete(receipts.keys().next().value!);
    receipts.set(request, { fingerprint, runId });
  };
  const replay = (request: string, fingerprint: string) => {
    const receipt = receipts.get(request);
    if (!receipt) return Effect.succeed(null);
    return receipt.fingerprint === fingerprint && runs.has(receipt.runId)
      ? Effect.succeed(runs.get(receipt.runId)!)
      : Effect.fail(new DevEnvironmentError({ reason: "request-conflict" }));
  };
  const startNew = Effect.fn("DevEnvironment.startNew")(function* (input: DevStart) {
    const context = yield* candidates(input);
    const candidate = context.candidates.find((entry) => entry.key === input.key);
    if (!candidate) return yield* new DevEnvironmentError({ reason: "candidate-not-found" });
    const running = [...runs.values()].find(
      (run) => run.root === context.root && run.key === candidate.key && active(run),
    );
    if (running) return running;
    const { project } = yield* workspace(input);
    const prepared = yield* profiles
      .varlockCommand({
        projectId: project.projectId,
        threadId: input.threadId,
        target: { command: candidate.command },
      })
      .pipe(
        Effect.mapError((cause) => new DevEnvironmentError({ reason: "terminal-failed", cause })),
      );
    const id = yield* crypto
      .uuidV4()
      .pipe(
        Effect.mapError((cause) => new DevEnvironmentError({ reason: "terminal-failed", cause })),
      );
    const run: DevServerRun = {
      id,
      key: candidate.key,
      name: candidate.name,
      command: candidate.command,
      root: context.root,
      threadId: input.threadId,
      terminalId: `loom-dev-${id}`,
      state: "starting",
      urls: [],
      output: "",
      exitCode: null,
      startedAt: DateTime.formatIso(yield* DateTime.now),
    };
    const completed = [...runs.values()].filter((entry) => !active(entry));
    for (const prior of completed.slice(0, Math.max(0, completed.length - 199)))
      runs.delete(prior.id);
    runs.set(id, run);
    const scope = yield* Scope.make();
    scopes.set(id, scope);
    const launch = Effect.gen(function* () {
      yield* terminals.open({
        threadId: run.threadId,
        terminalId: run.terminalId,
        cwd: run.root,
        worktreePath: run.root,
        env: { VARLOCK_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
      });
      yield* ports.retain.pipe(Effect.provideService(Scope.Scope, scope));
      yield* ports
        .subscribe(
          {
            configuredUrls: candidate.previewUrl ? [candidate.previewUrl] : [],
            initialSnapshot: [],
          },
          (servers) =>
            Effect.gen(function* () {
              const current = runs.get(id);
              if (!current || !active(current)) return;
              const urls = servers
                .filter(
                  (server) =>
                    server.terminal?.threadId === run.threadId &&
                    server.terminal?.terminalId === run.terminalId,
                )
                .map((server) => server.url);
              if (urls.join("\n") !== current.urls.join("\n")) {
                runs.set(id, { ...current, urls, state: urls.length ? "ready" : "running" });
                yield* notify();
              }
            }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));
      const shell = yield* terminals.getShell({
        threadId: run.threadId,
        terminalId: run.terminalId,
      });
      const line =
        platform === "win32" && /powershell|pwsh/i.test(shell)
          ? `& { ${prepared.commandLine} }; exit $LASTEXITCODE\r`
          : commandLine(prepared.commandLine, platform, shell);
      yield* terminals.write({ threadId: run.threadId, terminalId: run.terminalId, data: line });
    });
    yield* launch.pipe(
      Effect.tapError(() =>
        Effect.gen(function* () {
          runs.set(id, { ...run, state: "error" });
          yield* terminals
            .close({ threadId: run.threadId, terminalId: run.terminalId })
            .pipe(Effect.ignore);
          yield* finishScope(id);
          yield* notify();
        }),
      ),
      Effect.mapError((cause) => new DevEnvironmentError({ reason: "terminal-failed", cause })),
    );
    yield* notify();
    return runs.get(id)!;
  });
  const start = Effect.fn("DevEnvironment.start")(function* (input: DevStart) {
    const fingerprint = stableStringify(input);
    return (
      (yield* replay(input.requestId, fingerprint)) ??
      (yield* startNew(input).pipe(
        Effect.tap((run) => Effect.sync(() => remember(input.requestId, fingerprint, run.id))),
      ))
    );
  }, gate.withPermit);
  const control = Effect.fn("DevEnvironment.control")(function* (input: DevControl) {
    const { root } = yield* workspace(input);
    const run = runs.get(input.runId);
    if (!run || run.root !== root)
      return yield* new DevEnvironmentError({ reason: "run-not-found" });
    if (run.threadId !== input.threadId && !input.confirmOtherThread)
      return yield* new DevEnvironmentError({ reason: "confirm-other-thread" });
    const fingerprint = stableStringify(input);
    const prior = yield* replay(input.requestId, fingerprint);
    if (prior) return prior;
    if (active(run)) {
      yield* terminals
        .close({ threadId: run.threadId, terminalId: run.terminalId })
        .pipe(
          Effect.mapError((cause) => new DevEnvironmentError({ reason: "terminal-failed", cause })),
        );
      runs.set(run.id, { ...runs.get(run.id)!, state: "stopped", urls: [] });
      yield* finishScope(run.id);
    }
    const result =
      input.action === "restart"
        ? yield* startNew({ threadId: input.threadId, key: run.key, requestId: input.requestId })
        : runs.get(run.id)!;
    remember(input.requestId, fingerprint, result.id);
    yield* notify();
    return result;
  }, gate.withPermit);
  const onTerminalEvent = Effect.fn("DevEnvironment.terminalEvent")(function* (
    event: TerminalEvent,
  ) {
    const run = [...runs.values()].find(
      (entry) => entry.threadId === event.threadId && entry.terminalId === event.terminalId,
    );
    if (!run) return;
    if (event.type === "output")
      runs.set(run.id, { ...run, output: appendOutput(run.output, event.data) });
    else if (event.type === "exited" || event.type === "closed" || event.type === "error") {
      runs.set(run.id, {
        ...run,
        state: event.type === "exited" ? "exited" : event.type === "closed" ? "stopped" : "error",
        exitCode: event.type === "exited" ? event.exitCode : null,
        urls: [],
      });
      yield* finishScope(run.id);
    } else if (
      event.type === "activity" &&
      event.hasRunningSubprocess &&
      run.state === "starting"
    ) {
      runs.set(run.id, { ...run, state: "running" });
    } else return;
    yield* notify();
  });
  const unsubscribe = yield* terminals.subscribe(onTerminalEvent);
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      [...runs.values()].filter(active),
      (run) =>
        terminals.close({ threadId: run.threadId, terminalId: run.terminalId }).pipe(Effect.ignore),
      { discard: true },
    ),
  );
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...scopes.keys()], finishScope, { discard: true }),
  );
  return DevEnvironmentService.of({
    snapshot,
    start,
    control,
    watch: (input) =>
      Stream.unwrap(
        Effect.map(candidates(input), (context) =>
          SubscriptionRef.changes(changes).pipe(
            Stream.groupedWithin(256, "100 millis"),
            Stream.map(() => ({
              ...context,
              runs: [...runs.values()].filter((run) => run.root === context.root).toReversed(),
            })),
          ),
        ),
      ),
  });
});
export const layer = Layer.effect(DevEnvironmentService, make);
