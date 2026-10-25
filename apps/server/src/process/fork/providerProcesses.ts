// @effect-diagnostics nodeBuiltinImport:off -- synchronous spawn and signal callbacks must persist ownership before returning.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ProviderProcesses, type ProviderProcessRegistration } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";

const Identity = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(1)),
  pgid: Schema.Int.check(Schema.isGreaterThan(1)),
  lstart: Schema.String,
  // Command digests verify ownership without persisting credentials carried in argv.
  command: Schema.String,
});
const Record = Schema.Struct({
  ...Identity.fields,
  owner: Identity,
  threadId: Schema.optional(Schema.String),
  nativeSessionId: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});
type Record = typeof Record.Type;
type Identity = typeof Identity.Type;
const Document = Schema.Struct({ version: Schema.Literal(1), processes: Schema.Array(Record) });
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Document));

export interface ProcessRegistryHost {
  readonly owner: Identity;
  readonly inspect: (pid: number) => Identity | null;
  readonly members: (pgid: number) => ReadonlyArray<Identity>;
  readonly signal: (pgid: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly read: () => string | null;
  readonly write: (contents: string) => void;
}

const sameProcess = (record: Identity, current: Identity) =>
  record.pid === current.pid &&
  record.pgid === current.pgid &&
  record.lstart === current.lstart &&
  record.command === current.command;

export const makeRegistry = (host: ProcessRegistryHost) => {
  let stopping = false;
  const live = new Map<number, Record>();
  const previous = new Map<number, Record>();
  const serialized = host.read();
  if (serialized !== null)
    for (const record of decode(serialized).processes) previous.set(record.pid, record);
  const persist = () =>
    host.write(JSON.stringify({ version: 1, processes: [...previous.values(), ...live.values()] }));
  const inspect = (record: Record): "gone" | "owned" | "uncertain" => {
    try {
      const current = host.inspect(record.pid);
      if (current === null || current.lstart !== record.lstart) return "gone";
      return sameProcess(record, current) ? "owned" : "uncertain";
    } catch {
      return "uncertain";
    }
  };
  const reap = Effect.fn("ProviderProcesses.reap")(function* (threadId?: string) {
    if (previous.size === 0) return;
    const pending: Array<{ record: Record; members: ReadonlyArray<Record> }> = [];
    for (const record of previous.values()) {
      if (threadId !== undefined && record.threadId !== undefined && record.threadId !== threadId)
        continue;
      // A second server accidentally pointed at the same state directory owns no right
      // to terminate the first server's providers, even though the child identity matches.
      try {
        const owner = host.inspect(record.owner.pid);
        if (owner !== null && owner.lstart === record.owner.lstart) continue;
      } catch {
        continue;
      }
      const state = inspect(record);
      if (state === "gone") {
        previous.delete(record.pid);
        continue;
      }
      if (state !== "owned") continue;
      try {
        const members = host.members(record.pgid).map((member) => ({ ...record, ...member }));
        if (inspect(record) !== "owned") continue;
        host.signal(record.pgid, "SIGTERM");
        pending.push({
          record,
          members: [record, ...members.filter((member) => member.pid !== record.pid)],
        });
      } catch {
        /* Keep ownership so a failed stop blocks restart continuation. */
      }
    }
    if (pending.length > 0) yield* Effect.sleep("250 millis");
    for (const { record, members } of pending) {
      // The leader may exit on TERM while a plugin child ignores it. Pin members before
      // signalling so escalation still has an identity witness for the original group.
      if (members.some((member) => inspect(member) === "owned")) {
        try {
          host.signal(record.pgid, "SIGKILL");
        } catch {
          /* Retain and report below. */
        }
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
    blocks: (threadId, cwd) =>
      [...previous.values()].some(
        (record) =>
          (record.threadId === undefined ||
            record.threadId === threadId ||
            (cwd !== undefined && record.cwd === cwd)) &&
          inspect(record) !== "gone",
      ),
    stop: (threadId) => reap(threadId),
  });
};

const inspectProcess = (pid: number): Identity | null => {
  let output: string;
  try {
    output = NodeChildProcess.execFileSync(
      "/bin/ps",
      ["-ww", "-p", String(pid), "-o", "pgid=", "-o", "lstart=", "-o", "command="],
      {
        encoding: "utf8",
        timeout: 1000,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, LC_ALL: "C" },
      },
    ).trim();
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "status" in cause && cause.status === 1)
      return null;
    throw cause;
  }
  const match = /^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/s.exec(output);
  if (!match) throw new Error("Could not verify provider process identity");
  return {
    pid,
    pgid: Number(match[1]),
    lstart: match[2]!,
    command: NodeCrypto.createHash("sha256").update(match[3]!).digest("hex"),
  };
};

export const layer = Layer.effect(
  ProviderProcesses,
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) === "win32") return ProviderProcesses.defaultValue();
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const directory = NodePath.join(stateDir, "runtime");
    const path = NodePath.join(directory, "provider-processes.json");
    const registry = yield* Effect.try(() => {
      NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const owner = inspectProcess(process.pid);
      if (owner === null) throw new Error("Could not verify server process identity");
      return makeRegistry({
        owner,
        inspect: inspectProcess,
        members: (pgid) => {
          // Enumerate only numeric group membership; inspect commands only in the owned group.
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
      });
    }).pipe(Effect.orDie);
    yield* registry.reap;
    return registry;
  }),
);
