// @effect-diagnostics nodeBuiltinImport:off -- `ps` and process-group signals have no Effect platform API.
import * as NodeChildProcess from "node:child_process";

import {
  PS_TABLE_ARGS,
  decodeProviderProcessLedger,
  parsePsIdentity,
  parsePsTable,
  processState,
  psIdentityArgs,
  sameProcess,
  type ProcessIdentity,
  type ProviderProcessRecord,
} from "@t3tools/shared/fork/provider-processes";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { makeComponentLogger } from "../../app/DesktopObservability.ts";

/** Quit, update install and restart wait at most this long for the cleanup. */
export const CLEANUP_TIMEOUT = Duration.seconds(2);
// The server's reap waits the same: for TERM to land, then for KILL to.
const TERM_GRACE = Duration.millis(250);
const KILL_GRACE = Duration.millis(50);
const PS_TIMEOUT_MS = 1000;

const { logInfo, logWarning } = makeComponentLogger("orphaned-providers");

export type ProcessSignal = "SIGTERM" | "SIGKILL";

/** `ps` or a signal failed, so the processes involved are left alone. */
export class ProcessHostError extends Schema.TaggedError<ProcessHostError>()("ProcessHostError", {
  operation: Schema.Literals(["inspect", "table", "signal"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Process ${this.operation} failed.`;
  }
}

export interface ProcessHostShape {
  /** This desktop process, whose own group is never signalled. */
  readonly pid: number;
  /** One process's identity, or null when it no longer exists. */
  readonly inspect: (pid: number) => Effect.Effect<ProcessIdentity | null, ProcessHostError>;
  /** Every running process's identity, by PID. */
  readonly table: Effect.Effect<ReadonlyMap<number, ProcessIdentity>, ProcessHostError>;
  readonly signal: (pgid: number, signal: ProcessSignal) => Effect.Effect<void, ProcessHostError>;
}

const runPs = (operation: "inspect" | "table", args: ReadonlyArray<string>) =>
  Effect.callback<string | null, ProcessHostError>((resume) => {
    const child = NodeChildProcess.execFile(
      "/bin/ps",
      args,
      { encoding: "utf8", timeout: PS_TIMEOUT_MS, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        if (error === null) resume(Effect.succeed(stdout));
        // ps exits 1 when none of the listed processes exist.
        else if (error.code === 1) resume(Effect.succeed(null));
        else resume(Effect.fail(new ProcessHostError({ operation, cause: error })));
      },
    );
    return Effect.sync(() => {
      child.kill();
    });
  });

const liveHost: ProcessHostShape = {
  pid: process.pid,
  inspect: (pid) =>
    runPs("inspect", psIdentityArgs(pid)).pipe(
      Effect.flatMap((output) => {
        if (output === null) return Effect.succeed(null);
        const identity = parsePsIdentity(pid, output);
        return identity === null
          ? Effect.fail(
              new ProcessHostError({ operation: "inspect", cause: `unreadable output for ${pid}` }),
            )
          : Effect.succeed(identity);
      }),
    ),
  table: runPs("table", PS_TABLE_ARGS).pipe(
    Effect.flatMap((output) => {
      const table = output === null ? null : parsePsTable(output);
      return table === null
        ? Effect.fail(new ProcessHostError({ operation: "table", cause: "unreadable output" }))
        : Effect.succeed(table);
    }),
  ),
  signal: (pgid, signal) =>
    Effect.try({
      try: () => {
        process.kill(-pgid, signal);
      },
      catch: (cause) => new ProcessHostError({ operation: "signal", cause }),
    }),
};

/** Tests stand in for `ps` and signals here; the app always uses the real ones. */
export class ProviderProcessHost extends Context.Reference<ProcessHostShape>(
  "@t3tools/desktop/fork/orphaned-providers/ProviderProcessHost",
  { defaultValue: () => liveHost },
) {}

const stateIn = (identity: ProcessIdentity, table: ReadonlyMap<number, ProcessIdentity> | null) =>
  table === null ? "uncertain" : processState(identity, table.get(identity.pid) ?? null);

/** Mirrors the server's reap: verify, TERM, wait, then KILL only while a pinned member remains. */
const stopGroups = Effect.fn("desktop.orphanedProviders.stopGroups")(function* (
  host: ProcessHostShape,
  records: ReadonlyArray<ProviderProcessRecord>,
) {
  const before = yield* host.table;
  const ownGroup = before.get(host.pid)?.pgid;
  if (ownGroup === undefined) {
    return yield* new ProcessHostError({ operation: "table", cause: "the desktop is not listed" });
  }
  let leftRunning = 0;
  const pending: Array<{
    readonly pgid: number;
    readonly members: ReadonlyArray<ProcessIdentity>;
  }> = [];
  for (const record of records) {
    const state = stateIn(record, before);
    if (state === "gone") continue;
    if (state === "uncertain" || record.pgid <= 1 || record.pgid === ownGroup) {
      leftRunning += 1;
      continue;
    }
    // The leader may exit on TERM while a plugin child ignores it, so the group's members are
    // pinned first and KILL still has an identity witness for the original group.
    const members = [...before.values()].filter((member) => member.pgid === record.pgid);
    const terminated = yield* host.signal(record.pgid, "SIGTERM").pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (terminated) pending.push({ pgid: record.pgid, members });
    else leftRunning += 1;
  }
  if (pending.length === 0) return { stopped: 0, leftRunning };
  yield* Effect.sleep(TERM_GRACE);
  const afterTerm = yield* host.table.pipe(Effect.orElseSucceed(() => null));
  for (const { pgid, members } of pending) {
    if (members.some((member) => stateIn(member, afterTerm) === "owned")) {
      yield* host.signal(pgid, "SIGKILL").pipe(Effect.ignore);
    }
  }
  yield* Effect.sleep(KILL_GRACE);
  const afterKill = yield* host.table.pipe(Effect.orElseSucceed(() => null));
  const stopped = pending.filter(({ members }) =>
    members.every((member) => stateIn(member, afterKill) === "gone"),
  ).length;
  return { stopped, leftRunning: leftRunning + pending.length - stopped };
});

const stopOrphans = Effect.fn("desktop.orphanedProviders.stop")(function* (
  fileSystem: FileSystem.FileSystem,
  host: ProcessHostShape,
  ledgerPath: string,
  backend: ProcessIdentity,
) {
  // Read only: the server owns the ledger, and its next start revalidates whatever is left.
  const serialized = yield* fileSystem.readFileString(ledgerPath).pipe(
    Effect.asSome,
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeedNone,
    ),
  );
  if (Option.isNone(serialized)) return;
  const ledger = yield* Effect.try(() => decodeProviderProcessLedger(serialized.value));
  // Records of anything else, such as a second server on this state dir, are not ours to stop.
  const owned = ledger.processes.filter((record) => sameProcess(record.owner, backend));
  if (owned.length === 0) return;
  const { stopped, leftRunning } = yield* stopGroups(host, owned);
  // Providers usually exit with their backend's pipes; only survivors are worth a line.
  if (stopped + leftRunning === 0) return;
  yield* (leftRunning === 0 ? logInfo : logWarning)(
    "provider process groups outlived the backend",
    {
      backendPid: backend.pid,
      stopped,
      leftRunning,
    },
  );
});

export interface BackendProviders {
  /** Records the backend's identity right after spawn; without it nothing is ever stopped. */
  readonly started: (pid: number) => Effect.Effect<void>;
  /** After the backend exits, stops the provider groups it still owned. Bounded; never fails. */
  readonly exited: Effect.Effect<void>;
}

/**
 * Provider CLIs lead their own process groups, so they outlive a backend that is force-killed or
 * crashes. The next server start would reap them, but after a quit that can be hours later, so
 * each backend run stops the groups its dead backend's ledger still names, as reap would.
 */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const host = yield* ProviderProcessHost;
  const platform = yield* HostProcess.Platform;
  /** `ledgerPath` is set only for the primary local backend, whose state dir is the desktop's. */
  const watch = Effect.fn("desktop.orphanedProviders.watch")(function* (
    ledgerPath: string | undefined,
  ) {
    if (ledgerPath === undefined || platform === "win32") {
      return { started: () => Effect.void, exited: Effect.void } satisfies BackendProviders;
    }
    const backend = yield* Ref.make<ProcessIdentity | null>(null);
    return {
      started: (pid) =>
        host.inspect(pid).pipe(
          Effect.flatMap((identity) =>
            identity === null
              ? logWarning("backend exited before its identity was recorded", { pid })
              : Ref.set(backend, identity),
          ),
          Effect.catch((cause) =>
            logWarning("could not record the backend's identity", { pid, cause }),
          ),
        ),
      exited: Ref.getAndSet(backend, null).pipe(
        Effect.flatMap((identity) =>
          identity === null
            ? Effect.void
            : stopOrphans(fileSystem, host, ledgerPath, identity).pipe(
                Effect.timeoutOption(CLEANUP_TIMEOUT),
                Effect.flatMap((completed) =>
                  Option.isSome(completed)
                    ? Effect.void
                    : logWarning("ran out of time stopping providers the backend left running", {
                        backendPid: identity.pid,
                      }),
                ),
                Effect.catchCause((cause) =>
                  logWarning("could not stop providers the backend left running", {
                    backendPid: identity.pid,
                    cause,
                  }),
                ),
              ),
        ),
      ),
    } satisfies BackendProviders;
  });
  return { watch };
});
