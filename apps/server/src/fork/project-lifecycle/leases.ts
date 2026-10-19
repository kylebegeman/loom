// @effect-diagnostics nodeBuiltinImport:off - Leases are found with stat and signalled by pid.
import * as NodeFSP from "node:fs/promises";
import type { LaneLease } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProcessRunner } from "../../processRunner.ts";

/**
 * Leases are what a lane owns outside its space: processes started with `lane-run`, simulators
 * made in the lane, Docker containers and volumes labelled `loom.lane=<id>`, and listeners on
 * the lane's ports. The ledger only ever grows; an entry counts while what it names is alive.
 */

export const DOCKER_LABEL = "loom.lane";

export interface LedgerEntry {
  readonly kind: "process" | "simulator";
  readonly ref: string;
  readonly label: string;
  /** Process start time for processes, epoch seconds for simulators. */
  readonly stamp: string;
}

/** Latest entry per kind and ref; malformed lines are skipped. */
export const parseLedger = (text: string): ReadonlyArray<LedgerEntry> => {
  const entries = new Map<string, LedgerEntry>();
  for (const line of text.split("\n")) {
    const [kind, ref, label = "", stamp = ""] = line.split("\t");
    if ((kind !== "process" && kind !== "simulator") || !ref) continue;
    if (kind === "process" && !/^\d+$/.test(ref)) continue;
    entries.set(`${kind}\t${ref}`, { kind, ref, label, stamp: normalizeStart(stamp) });
  }
  return [...entries.values()];
};

export const ledgerLine = (entry: LedgerEntry) =>
  `${entry.kind}\t${entry.ref}\t${entry.label.replace(/[\t\n\r]/g, " ").slice(0, 200)}\t${entry.stamp}\n`;

/** ps pads start times; both sides compare collapsed. */
export const normalizeStart = (value: string) => value.trim().replace(/\s+/g, " ");

export interface ProcessInfo {
  readonly ppid: number;
  readonly started: string;
}

/** Output of `ps -Ao pid=,ppid=,lstart=` under the C locale. */
export const parseProcessTable = (stdout: string) => {
  const table = new Map<number, ProcessInfo>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match)
      table.set(Number(match[1]), { ppid: Number(match[2]), started: normalizeStart(match[3]!) });
  }
  return table;
};

/** The roots and every process below them. */
export const withDescendants = (
  table: ReadonlyMap<number, ProcessInfo>,
  roots: Iterable<number>,
) => {
  const children = new Map<number, Array<number>>();
  for (const [pid, info] of table) {
    const list = children.get(info.ppid);
    if (list) list.push(pid);
    else children.set(info.ppid, [pid]);
  }
  const found = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (found.has(pid) || !table.has(pid)) continue;
    found.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
};

/** This process and everything above it; never signalled. */
export const ancestorsOf = (table: ReadonlyMap<number, ProcessInfo>, pid: number) => {
  const found = new Set<number>([pid]);
  let current = table.get(pid)?.ppid;
  while (current !== undefined && current > 1 && !found.has(current)) {
    found.add(current);
    current = table.get(current)?.ppid;
  }
  return found;
};

/** A ledger process counts while the same pid has the same start time. */
export const liveProcess = (table: ReadonlyMap<number, ProcessInfo>, entry: LedgerEntry) =>
  entry.kind === "process" && table.get(Number(entry.ref))?.started === entry.stamp;

const SimctlDevices = Schema.fromJsonString(
  Schema.Struct({
    devices: Schema.Record(
      Schema.String,
      Schema.Array(
        Schema.Struct({ udid: Schema.String, name: Schema.String, state: Schema.String }),
      ),
    ),
  }),
);

const decodeSimctlDevices = Schema.decodeEffect(SimctlDevices);

export const parseSimulators = (stdout: string) =>
  decodeSimctlDevices(stdout).pipe(
    Effect.map(
      (list) =>
        new Map(
          Object.values(list.devices)
            .flat()
            .map((device) => [device.udid, { name: device.name, state: device.state }] as const),
        ),
    ),
  );

export interface DockerResource {
  readonly kind: "container" | "volume";
  readonly ref: string;
  readonly laneId: string;
  readonly label: string;
}

/** Lines of `id\tlane\tname\tstate` for containers or `name\tlane` for volumes. */
export const parseDocker = (kind: DockerResource["kind"], stdout: string) =>
  stdout.split("\n").flatMap((line): Array<DockerResource> => {
    const [ref, laneId, name, state] = line.trim().split("\t");
    if (!ref || !laneId) return [];
    const label = kind === "container" ? `${name ?? ref}${state ? ` (${state})` : ""}` : ref;
    return [{ kind, ref, laneId, label }];
  });

export interface Listener {
  readonly command: string;
  readonly ports: ReadonlySet<number>;
}

/** `lsof -F pcn` prints `p<pid>` and `c<command>`, then `f<fd>` and `n<address>` per socket. */
export const parseLsofListeners = (stdout: string) => {
  const listeners = new Map<number, { command: string; ports: Set<number> }>();
  let current: { command: string; ports: Set<number> } | undefined;
  for (const line of stdout.split("\n")) {
    const value = line.slice(1);
    if (line.startsWith("p")) {
      current = /^\d+$/.test(value) ? { command: "", ports: new Set() } : undefined;
      if (current) listeners.set(Number(value), current);
    } else if (current && line.startsWith("c")) current.command = value;
    else if (current && line.startsWith("n")) {
      const port = /:(\d+)$/.exec(value)?.[1];
      if (port !== undefined) current.ports.add(Number(port));
    }
  }
  return listeners;
};

/**
 * Host ports from `docker ps --format '{{.Ports}}'`, for example
 * `127.0.0.1:41003->80/tcp, [::]:41003->80/tcp` or `0.0.0.0:41003-41005->80-82/tcp`.
 * Exposed but unpublished ports (`80/tcp`) have no host side and are skipped.
 */
export const parsePublishedPorts = (stdout: string) => {
  const ports = new Set<number>();
  for (const entry of stdout.split(/[,\n]/)) {
    const match = /:(\d+)(?:-(\d+))?->/.exec(entry);
    if (!match) continue;
    const first = Number(match[1]);
    const last = Math.min(Number(match[2] ?? first), 65535);
    for (let port = first; port <= last; port++) ports.add(port);
  }
  return ports;
};

/**
 * Host processes that forward published container ports: Docker Desktop, OrbStack, Colima and
 * Lima, Podman, and dockerd with docker-proxy, rootlesskit, rootlessport or slirp4netns on
 * Linux. Names only ever spare a process; nothing is signalled because of its name.
 */
const CONTAINER_RUNTIME =
  /^(com\.docker\.|vpnkit|docker-proxy|dockerd|rootlesskit|rootlessport|slirp4netns|orbstack|limactl|gvproxy)/i;

/** A command name or, as macOS `ps -o comm` prints it, an executable path. */
export const isContainerRuntime = (command: string) =>
  CONTAINER_RUNTIME.test(command.slice(command.lastIndexOf("/") + 1));

/** Output of `ps -Ao pid=,comm=`: the pids of container runtime processes. */
export const parseRuntimeProcesses = (stdout: string) => {
  const pids = new Set<number>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (match && isContainerRuntime(match[2]!.trim())) pids.add(Number(match[1]));
  }
  return pids;
};

/**
 * A lane port listener that belongs to a container runtime rather than the lane: it holds a
 * port a running container publishes, or it is a runtime's forwarder. Stopping it would cut off
 * every container on the computer. `published` is null when Docker is missing or not running;
 * then nothing proves a port unpublished, and the name is the only evidence left.
 */
export const runtimeOwned = (listener: Listener, published: ReadonlySet<number> | null) =>
  isContainerRuntime(listener.command) ||
  (published !== null && [...listener.ports].some((port) => published.has(port)));

/** Lane port listeners split into those the lane may stop and those a container runtime owns. */
export const partitionListeners = (
  listeners: ReadonlyMap<number, Listener>,
  published: ReadonlySet<number> | null,
) => {
  const lane = new Set<number>();
  const runtime = new Set<number>();
  for (const [pid, listener] of listeners)
    (runtimeOwned(listener, published) ? runtime : lane).add(pid);
  return { lane, runtime };
};

/** pid 0 and negative pids signal whole process groups, 1 is init, and this server stays up. */
export const signallable = (pid: number) =>
  Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid;

export interface SlotHolder {
  readonly slot: number;
  readonly pid: number;
  readonly started: string;
  readonly spacePath: string;
  readonly command: string;
}

export const parseSlotHolder = (slot: number, text: string): SlotHolder | null => {
  const [pid, started = "", spacePath = "", command = ""] = text.replace(/\n$/, "").split("\t");
  return pid && /^\d+$/.test(pid)
    ? { slot, pid: Number(pid), started: normalizeStart(started), spacePath, command }
    : null;
};

export const leaseOf = (entry: LedgerEntry | DockerResource): LaneLease => ({
  kind: entry.kind,
  ref: entry.ref,
  label: entry.label,
});

/** Where docker is looked for, in order. Docker Desktop and OrbStack do not always link to PATH. */
export const dockerCandidates = (homeDir: string, pathEnv = process.env.PATH ?? "") => [
  ...pathEnv
    .split(":")
    .filter(Boolean)
    .map((dir) => `${dir}/docker`),
  `${homeDir}/.docker/bin/docker`,
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  `${homeDir}/.orbstack/bin/docker`,
];

/** Docker can be installed while Loom runs, so a miss is only trusted this long. */
export const DOCKER_MISS_RETRY_MS = 60_000;

const isExecutable = (path: string) =>
  Effect.promise(() =>
    NodeFSP.access(path, NodeFSP.constants.X_OK).then(
      () => true,
      () => false,
    ),
  );

/** The first executable candidate. A hit is kept; a miss is looked up again after a minute. */
export const makeDockerLocator = (candidates: () => ReadonlyArray<string>) => {
  let found: string | null = null;
  let missedAt: number | null = null;
  return Effect.gen(function* () {
    if (found !== null) return found;
    const now = yield* Clock.currentTimeMillis;
    if (missedAt !== null && now - missedAt < DOCKER_MISS_RETRY_MS) return null;
    for (const candidate of candidates())
      if (yield* isExecutable(candidate)) {
        found = candidate;
        return candidate;
      }
    missedAt = now;
    return null;
  });
};

/** Commands that look at and release leases. Every query degrades to "unknown" on failure. */
export const makeLeaseOps = (options: {
  readonly homeDir: string;
  readonly xcrunPath: string;
  readonly lsofPath: string;
  readonly dockerPath: string | undefined;
}) =>
  Effect.gen(function* () {
    const runner = yield* ProcessRunner;

    const run = (command: string, args: ReadonlyArray<string>) =>
      runner
        .run({
          command,
          args,
          timeout: "30 seconds",
          maxOutputBytes: 4 * 1024 * 1024,
          env: { ...process.env, LC_ALL: "C" },
        })
        .pipe(Effect.option);

    const stdoutOf = (command: string, args: ReadonlyArray<string>) =>
      run(command, args).pipe(
        Effect.map((output) =>
          output._tag === "Some" && output.value.code === 0 ? output.value.stdout : null,
        ),
      );

    const dockerPath =
      options.dockerPath === undefined
        ? makeDockerLocator(() => dockerCandidates(options.homeDir))
        : Effect.succeed(options.dockerPath);

    const processTable = stdoutOf("ps", ["-Ao", "pid=,ppid=,lstart="]).pipe(
      Effect.map((stdout) => (stdout === null ? null : parseProcessTable(stdout))),
    );

    const simulators = stdoutOf(options.xcrunPath, ["simctl", "list", "devices", "-j"]).pipe(
      Effect.flatMap((stdout) =>
        stdout === null ? Effect.succeed(null) : parseSimulators(stdout),
      ),
      Effect.orElseSucceed(() => null),
    );

    /** Labelled containers and volumes, or null when Docker is missing or not running. */
    const dockerResources = Effect.gen(function* () {
      const path = yield* dockerPath;
      if (path === null) return null;
      const containers = yield* stdoutOf(path, [
        "ps",
        "-a",
        "--filter",
        `label=${DOCKER_LABEL}`,
        "--format",
        `{{.ID}}\t{{.Label "${DOCKER_LABEL}"}}\t{{.Names}}\t{{.State}}`,
      ]);
      if (containers === null) return null;
      const volumes = yield* stdoutOf(path, [
        "volume",
        "ls",
        "--filter",
        `label=${DOCKER_LABEL}`,
        "--format",
        `{{.Name}}\t{{.Label "${DOCKER_LABEL}"}}`,
      ]);
      return [...parseDocker("container", containers), ...parseDocker("volume", volumes ?? "")];
    });

    /** Host ports running containers publish, or null when Docker is missing or not running. */
    const publishedPorts = Effect.gen(function* () {
      const path = yield* dockerPath;
      if (path === null) return null;
      const stdout = yield* stdoutOf(path, ["ps", "--format", "{{.Ports}}"]);
      return stdout === null ? null : parsePublishedPorts(stdout);
    });

    /** Container runtime processes found by name anywhere on the computer, or null on failure. */
    const runtimeProcesses = stdoutOf("ps", ["-Ao", "pid=,comm="]).pipe(
      Effect.map((stdout) => (stdout === null ? null : parseRuntimeProcesses(stdout))),
    );

    const listeners = (first: number, last: number) =>
      stdoutOf(options.lsofPath, ["-nP", `-iTCP:${first}-${last}`, "-sTCP:LISTEN", "-Fpcn"]).pipe(
        Effect.map((stdout) => parseLsofListeners(stdout ?? "")),
      );

    const signal = (pid: number, name: NodeJS.Signals | 0) => {
      try {
        process.kill(pid, name);
        return true;
      } catch {
        return false;
      }
    };

    /** SIGTERM, up to five seconds to exit, then SIGKILL. Returns pids still alive. */
    const terminate = (requested: ReadonlySet<number>) =>
      Effect.gen(function* () {
        const pids = [...requested].filter(signallable);
        if (pids.length === 0) return [];
        for (const pid of pids) signal(pid, "SIGTERM");
        let alive = pids;
        for (let attempt = 0; attempt < 25 && alive.length > 0; attempt++) {
          yield* Effect.sleep("200 millis");
          alive = alive.filter((pid) => signal(pid, 0));
        }
        for (const pid of alive) signal(pid, "SIGKILL");
        yield* Effect.sleep("200 millis");
        return alive.filter((pid) => signal(pid, 0));
      });

    const checked = (label: string, command: string | null, args: ReadonlyArray<string>) =>
      command === null
        ? Effect.succeed(`${label}: not available`)
        : run(command, args).pipe(
            Effect.map((output) =>
              output._tag === "Some" && output.value.code === 0
                ? null
                : `${label}: ${output._tag === "Some" ? (output.value.stderr || output.value.stdout).trim() : "could not run"}`,
            ),
          );

    const removeDocker = (resource: Pick<DockerResource, "kind" | "ref">) =>
      Effect.gen(function* () {
        const path = yield* dockerPath;
        return yield* resource.kind === "container"
          ? checked(`docker rm ${resource.ref}`, path, ["rm", "-f", resource.ref])
          : checked(`docker volume rm ${resource.ref}`, path, ["volume", "rm", "-f", resource.ref]);
      });

    const deleteSimulator = (udid: string) =>
      run(options.xcrunPath, ["simctl", "shutdown", udid]).pipe(
        Effect.andThen(
          checked(`simctl delete ${udid}`, options.xcrunPath, ["simctl", "delete", udid]),
        ),
      );

    return {
      processTable,
      simulators,
      dockerResources,
      publishedPorts,
      runtimeProcesses,
      listeners,
      terminate,
      removeDocker,
      deleteSimulator,
    };
  });

export type LeaseOps = Effect.Success<ReturnType<typeof makeLeaseOps>>;
