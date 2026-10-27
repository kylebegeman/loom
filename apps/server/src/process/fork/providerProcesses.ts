// @effect-diagnostics nodeBuiltinImport:off -- synchronous spawn and signal callbacks must persist ownership before returning.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ProviderProcesses, type ProviderProcessRegistration } from "@t3tools/shared/AgentScope";
import {
  PROVIDER_PROCESS_LEDGER_PATH,
  decodeProviderProcessLedger as decode,
  parsePsIdentity,
  processState,
  psIdentityArgs,
  type ProcessIdentity as Identity,
  type ProviderProcessRecord as Record,
} from "@t3tools/shared/fork/provider-processes";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../../config.ts";

export interface ProcessRegistryHost {
  readonly owner: Identity;
  readonly inspect: (pid: number) => Identity | null;
  readonly members: (pgid: number) => ReadonlyArray<Identity>;
  readonly signal: (pgid: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly read: () => string | null;
  readonly write: (contents: string) => void;
}

// Shared providers carry no thread, so they hold every thread; a folder match keeps two
// conversations from writing to one checkout.
const holds = (record: Record, threadId?: string, cwd?: string) =>
  threadId === undefined ||
  record.threadId === undefined ||
  record.threadId === threadId ||
  (cwd !== undefined && record.cwd === cwd);

export const makeRegistry = (
  host: ProcessRegistryHost,
  onUnreadable?: (cause: unknown) => void,
) => {
  let stopping = false;
  const live = new Map<number, Record>();
  const previous = new Map<number, Record>();
  try {
    const serialized = host.read();
    if (serialized !== null)
      for (const record of decode(serialized).processes) previous.set(record.pid, record);
  } catch (cause) {
    // An unreadable ledger must not keep the server from starting; the next write replaces it.
    onUnreadable?.(cause);
  }
  const persist = () =>
    host.write(JSON.stringify({ version: 1, processes: [...previous.values(), ...live.values()] }));
  const inspect = (record: Record): "gone" | "owned" | "uncertain" => {
    try {
      return processState(record, host.inspect(record.pid));
    } catch {
      return "uncertain";
    }
  };
  const reap = Effect.fn("ProviderProcesses.reap")(function* (threadId?: string, cwd?: string) {
    if (previous.size === 0) return;
    const pending: Array<{ record: Record; members: ReadonlyArray<Record> }> = [];
    for (const record of previous.values()) {
      if (!holds(record, threadId, cwd)) continue;
      // A second server accidentally pointed at the same state directory owns no right
      // to terminate the first server's providers, even though the child identity matches.
      const ownerAlive = yield* Effect.try(() => {
        const owner = host.inspect(record.owner.pid);
        return owner !== null && owner.lstart === record.owner.lstart;
      }).pipe(Effect.orElseSucceed(() => true));
      if (ownerAlive) continue;
      const state = inspect(record);
      if (state === "gone") {
        previous.delete(record.pid);
        continue;
      }
      if (state !== "owned") continue;
      // A failed stop keeps ownership so it blocks restart continuation.
      yield* Effect.try(() => {
        const members = host.members(record.pgid).map((member) => ({ ...record, ...member }));
        if (inspect(record) !== "owned") return;
        host.signal(record.pgid, "SIGTERM");
        pending.push({
          record,
          members: [record, ...members.filter((member) => member.pid !== record.pid)],
        });
      }).pipe(Effect.ignore);
    }
    if (pending.length > 0) yield* Effect.sleep("250 millis");
    for (const { record, members } of pending) {
      // The leader may exit on TERM while a plugin child ignores it. Pin members before
      // signalling so escalation still has an identity witness for the original group.
      if (members.some((member) => inspect(member) === "owned")) {
        // A failed kill is retained and reported below.
        yield* Effect.try(() => host.signal(record.pgid, "SIGKILL")).pipe(Effect.ignore);
      }
    }
    if (pending.length > 0) yield* Effect.sleep("50 millis");
    for (const { record, members } of pending) {
      previous.delete(record.pid);
      const survivors = members.filter((member) => inspect(member) !== "gone");
      for (const survivor of survivors) previous.set(survivor.pid, survivor);
      if (survivors.length === 0) {
        yield* Effect.logInfo("Stopped a provider left by a previous server", {
          pid: record.pid,
          threadId: record.threadId,
        });
      } else {
        yield* Effect.logWarning("A previous agent is still running in this folder", {
          pid: record.pid,
          threadId: record.threadId,
        });
      }
    }
    yield* Effect.try(persist).pipe(
      Effect.catch(() => Effect.logWarning("Could not update provider process ownership")),
    );
  });
  return ProviderProcesses.of({
    register(input: ProviderProcessRegistration) {
      let identity: Identity | null;
      try {
        identity = host.inspect(input.pid);
      } catch (cause) {
        try {
          host.signal(input.pid, "SIGKILL");
        } catch {
          /* Only the freshly spawned PID is eligible. */
        }
        throw cause;
      }
      if (identity === null) return () => {};
      if (identity.pgid !== input.pid)
        throw new Error("Provider process is not its process group leader");
      const record = { ...input, ...identity, owner: host.owner };
      live.set(input.pid, record);
      try {
        persist();
      } catch (cause) {
        // An unrecorded detached process must not survive a failed acquisition.
        try {
          host.signal(identity.pgid, "SIGKILL");
        } catch {
          /* Preserve the original I/O error. */
        }
        throw cause;
      }
      if (stopping) {
        try {
          host.signal(identity.pgid, "SIGTERM");
        } catch {
          /* Teardown also closes the session. */
        }
      }
      return () => {
        if (live.get(input.pid) !== record) return;
        live.delete(input.pid);
        try {
          persist();
        } catch {
          /* A stale record is revalidated on the next boot. */
        }
      };
    },
    signalAll() {
      stopping = true;
      for (const record of live.values()) {
        try {
          host.signal(record.pgid, "SIGTERM");
        } catch {
          /* Session finalizers still run. */
        }
      }
    },
    reap: reap(),
    blocker: (threadId, cwd) =>
      [...previous.values()].find(
        (record) => holds(record, threadId, cwd) && inspect(record) !== "gone",
      )?.pid,
    // reap owns the span.
    stop: Effect.fnUntraced(function* (threadId, cwd) {
      return yield* reap(threadId, cwd);
    }),
  });
};

const inspectProcess = (pid: number): Identity | null => {
  let output: string;
  try {
    output = NodeChildProcess.execFileSync("/bin/ps", psIdentityArgs(pid), {
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C" },
    });
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 1)
      return null;
    throw cause;
  }
  const identity = parsePsIdentity(pid, output);
  if (identity === null) throw new Error("Could not verify provider process identity");
  return identity;
};

export const layer = Layer.effect(
  ProviderProcesses,
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32") return ProviderProcesses.defaultValue();
    // A Library authority runs no providers by default, and its image ships no `ps`.
    const libraryAuthority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
      Config.withDefault(false),
    );
    const supportsExecution = yield* Config.Boolean("LOOM_EXECUTION_ENABLED").pipe(
      Config.withDefault(!libraryAuthority),
    );
    if (!supportsExecution) return ProviderProcesses.defaultValue();
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const path = NodePath.join(stateDir, ...PROVIDER_PROCESS_LEDGER_PATH);
    const directory = NodePath.dirname(path);
    let unreadable: unknown;
    const registry = yield* Effect.try(() => {
      NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const owner = inspectProcess(process.pid);
      if (owner === null) throw new Error("Could not verify server process identity");
      return makeRegistry(
        {
          owner,
          inspect: inspectProcess,
          members: (pgid) => {
            // Enumerate only numeric group membership; inspect only members of the owned group.
            const output = NodeChildProcess.execFileSync(
              "/bin/ps",
              ["-A", "-o", "pid=", "-o", "pgid="],
              { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] },
            );
            return output.split("\n").flatMap((line) => {
              const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
              if (!match || Number(match[2]) !== pgid) return [];
              const member = inspectProcess(Number(match[1]));
              return member !== null && member.pgid === pgid ? [member] : [];
            });
          },
          signal: (pgid, signal) => process.kill(-pgid, signal),
          read: () => {
            try {
              return NodeFS.readFileSync(path, "utf8");
            } catch (cause) {
              if (
                typeof cause === "object" &&
                cause !== null &&
                "code" in cause &&
                cause.code === "ENOENT"
              )
                return null;
              throw cause;
            }
          },
          write: (contents) => {
            const temporary = `${path}.${process.pid}.tmp`;
            NodeFS.writeFileSync(temporary, contents, { mode: 0o600 });
            NodeFS.renameSync(temporary, path);
          },
        },
        (cause) => {
          unreadable = cause;
        },
      );
    }).pipe(
      // Without a verified server identity nothing can be proven owned, so nothing is reaped;
      // the server still starts.
      Effect.catch((cause) =>
        Effect.logWarning("Provider process ownership is unavailable", { cause }).pipe(
          Effect.as(ProviderProcesses.defaultValue()),
        ),
      ),
    );
    if (unreadable !== undefined)
      yield* Effect.logWarning("Discarded an unreadable provider process ledger", {
        cause: unreadable,
      });
    yield* registry.reap;
    return registry;
  }),
);
