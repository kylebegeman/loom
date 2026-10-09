// @effect-diagnostics nodeBuiltinImport:off - Graphify writes into a state folder Loom reads and deletes.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  CODE_GRAPH_MAX_GRAPH_BYTES,
  CodeGraphError,
  TESTED_GRAPHIFY_VERSION,
  graphifyInstallCommands,
  type CodeGraphAvailability,
  type CodeGraphBuildMode,
  type CodeGraphImpactInput,
  type CodeGraphImpactResult,
  type CodeGraphSettingsPatch,
  type CodeGraphStatus,
} from "@t3tools/contracts/fork";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Index from "./CodeGraphIndex.ts";
import {
  graphifyEnvironment,
  isShrinkRefusal,
  isTestedVersion,
  parseGraphifyVersion,
  startGraphify,
  type GraphifyInvocation,
  type GraphifyProcess,
} from "./CodeGraphRunner.ts";
import { makeCodeGraphStore, mergeSettings, type GraphRecord } from "./CodeGraphStore.ts";
import { makeGit } from "./git.ts";

const AVAILABILITY_TTL_MS = 60_000;
/** `uvx` may download Graphify on its first run. */
const VERSION_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;
const FRESHNESS_TTL_MS = 30_000;
/** Automatic updates of one project start at most this often. */
const AUTO_UPDATE_FLOOR_MS = 2 * 60_000;
/** Progress lines reach subscribers at most twice a second. */
const PROGRESS_NOTIFY_MS = 500;
/** Project indexes kept in memory. */
const INDEXES_KEPT = 2;
const ERROR_DETAIL_LINES = 40;

const MODE_STRENGTH: Record<CodeGraphBuildMode, number> = { update: 0, full: 1, force: 2 };

const error = (reason: CodeGraphError["reason"], message: string) =>
  new CodeGraphError({ reason, message });

export const invalidGraphMessage = (version: string | null, problem: string) =>
  `This graph was built by Graphify ${version ?? "of an unknown version"} and does not have the ` +
  `shape Loom reads (${problem}). Loom is tested with Graphify ${TESTED_GRAPHIFY_VERSION}: ` +
  graphifyInstallCommands()[0];

const statSize = (path: string) =>
  Effect.promise(() =>
    NodeFSP.stat(path).then(
      (stat) => stat.size,
      () => null,
    ),
  );

interface ActiveBuild {
  readonly mode: CodeGraphBuildMode;
  readonly startedAt: string;
  lastLine: string;
  process: GraphifyProcess | null;
  cancelled: boolean;
}

interface QueuedBuild {
  readonly mode: CodeGraphBuildMode;
  /** Automatic updates give way to anything a user asks for. */
  readonly auto: boolean;
}

interface Freshness {
  readonly at: number;
  readonly head: string | null;
  readonly fingerprint: string | null;
}

export interface CodeGraphOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly buildTimeoutMs?: number;
  readonly freshnessTtlMs?: number;
}

export const makeWith = (options: CodeGraphOptions) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const threads = yield* ProjectionStore.ProjectionStoreV2;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const store = yield* makeCodeGraphStore;
    const git = yield* makeGit;
    const serviceScope = yield* Effect.scope;

    const root = NodePath.join(config.stateDir, "fork", "code-graph");
    // Project ids name folders; encoding keeps any id inside the root.
    const outDirOf = (projectId: string) => NodePath.join(root, encodeURIComponent(projectId));
    const graphFileOf = (projectId: string) => NodePath.join(outDirOf(projectId), "graph.json");
    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

    yield* store.resetBuilding(yield* nowIso).pipe(Effect.orDie);
    let settings = yield* store.getSettings().pipe(Effect.orDie);
    const buildLock = yield* Semaphore.make(1);
    const queued = new Map<string, QueuedBuild>();
    const active = new Map<string, ActiveBuild>();
    const listeners = new Set<(projectId: string) => void>();
    /** Insertion order is recency: the first key is the least recently used. */
    const indexes = new Map<string, Index.CodeGraphIndex>();
    const freshness = new Map<string, Freshness>();
    const lastAutoUpdate = new Map<string, number>();
    let availabilityCache: {
      readonly at: number;
      readonly key: string;
      readonly value: CodeGraphAvailability;
    } | null = null;

    const notify = (projectId: string) => {
      for (const listener of listeners) listener(projectId);
    };

    const rememberIndex = (projectId: string, index: Index.CodeGraphIndex) => {
      indexes.delete(projectId);
      indexes.set(projectId, index);
      while (indexes.size > INDEXES_KEPT) indexes.delete(indexes.keys().next().value!);
    };

    // --- Graphify -------------------------------------------------------------------------

    const availability = (refresh = false) =>
      Effect.gen(function* () {
        const key = settings.command.join("\0");
        const now = yield* Clock.currentTimeMillis;
        if (
          !refresh &&
          availabilityCache?.key === key &&
          now - availabilityCache.at < AVAILABILITY_TTL_MS
        ) {
          return availabilityCache.value;
        }
        const child = yield* startGraphify({
          command: settings.command,
          invocation: { _tag: "version" },
          env: graphifyEnvironment(options.env, root),
          timeoutMs: VERSION_TIMEOUT_MS,
        });
        const code = yield* child.exit;
        const version = code === 0 ? parseGraphifyVersion(child.lines().join("\n")) : null;
        const value: CodeGraphAvailability =
          version === null
            ? {
                _tag: "missing",
                command: settings.command,
                installHint: graphifyInstallCommands()[0]!,
              }
            : { _tag: "available", version, tested: isTestedVersion(version) };
        availabilityCache = { at: now, key, value };
        return value;
      });

    const requireGraphify = availability().pipe(
      Effect.flatMap((value) =>
        value._tag === "available"
          ? Effect.succeed(value)
          : Effect.fail(
              error(
                "graphify-missing",
                `Graphify is not installed on this environment. Install it with: ${value.installHint}`,
              ),
            ),
      ),
    );

    // --- Projects and freshness -------------------------------------------------------------

    const projectOf = (projectId: string) =>
      projects.get(ProjectId.make(projectId)).pipe(
        Effect.orElseSucceed(() => Option.none()),
        Effect.flatMap((project) =>
          Option.isSome(project)
            ? Effect.succeed(project.value)
            : Effect.fail(error("project-not-found", "The project was not found.")),
        ),
      );

    const blankRecord = (projectId: string, workspaceRoot: string): GraphRecord => ({
      projectId,
      workspaceRoot,
      outDir: outDirOf(projectId),
      state: "none",
      builtAt: null,
      builtAtCommit: null,
      treeFingerprint: null,
      graphifyVersion: null,
      nodeCount: 0,
      edgeCount: 0,
      graphBytes: 0,
      agentTool: false,
      error: null,
      updatedAt: "",
    });

    const freshnessOf = (record: GraphRecord) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        let fresh = freshness.get(record.projectId);
        if (fresh === undefined || now - fresh.at >= (options.freshnessTtlMs ?? FRESHNESS_TTL_MS)) {
          const [head, fingerprint] = yield* Effect.all(
            [git.head(record.workspaceRoot), git.treeFingerprint(record.workspaceRoot)],
            { concurrency: "unbounded" },
          );
          fresh = { at: now, head, fingerprint };
          freshness.set(record.projectId, fresh);
        }
        return {
          head: fresh.head,
          stale:
            fresh.head !== null &&
            record.builtAtCommit !== null &&
            fresh.head !== record.builtAtCommit,
          dirty:
            fresh.fingerprint !== null &&
            record.treeFingerprint !== null &&
            fresh.fingerprint !== record.treeFingerprint,
        };
      });

    const statusOf = (projectId: string) =>
      Effect.gen(function* () {
        const project = yield* projectOf(projectId);
        // Read the live build before the stored record: a build that finishes in between then
        // reads as still building, and its final notification corrects it. The other order
        // could report the old record as idle.
        const live = active.get(projectId);
        const isQueued = !live && queued.has(projectId);
        const record =
          (yield* store.get(projectId).pipe(Effect.orDie)) ??
          blankRecord(projectId, project.workspaceRoot);
        const fresh =
          record.builtAt === null
            ? { head: null, stale: false, dirty: false }
            : yield* freshnessOf(record);
        return {
          projectId: project.projectId,
          projectName: project.title,
          availability: yield* availability(),
          state: live ? "building" : record.state,
          builtAt: record.builtAt,
          builtAtCommit: record.builtAtCommit,
          graphifyVersion: record.graphifyVersion,
          headCommit: fresh.head,
          stale: fresh.stale,
          dirty: fresh.dirty,
          nodeCount: record.nodeCount,
          edgeCount: record.edgeCount,
          graphBytes: record.graphBytes,
          queued: isQueued,
          progress: live
            ? { mode: live.mode, startedAt: live.startedAt, lastLine: live.lastLine }
            : null,
          error: live ? null : record.error,
          agentTool: record.agentTool,
        } satisfies CodeGraphStatus;
      });

    // --- Builds -----------------------------------------------------------------------------

    /** Reads a finished build's graph.json into the record and the index cache. */
    const loadBuilt = (projectId: string, built: GraphRecord) =>
      Effect.gen(function* () {
        const file = graphFileOf(projectId);
        const size = yield* statSize(file);
        if (size === null) {
          return {
            ...built,
            state: "failed" as const,
            error: {
              summary: "Graphify finished without writing a graph.",
              detail: "",
              shrinkRefused: false,
            },
          };
        }
        if (size > CODE_GRAPH_MAX_GRAPH_BYTES) {
          return {
            ...built,
            state: "failed" as const,
            error: {
              summary: "The graph is larger than 100 MB and was not loaded.",
              detail: `${file} is ${Math.round(size / 1024 / 1024)} MB.`,
              shrinkRefused: false,
            },
          };
        }
        const parsed = yield* readGraph(file);
        if (!parsed.ok) {
          return {
            ...built,
            state: "failed" as const,
            error: {
              summary: invalidGraphMessage(parsed.graphifyVersion, parsed.problem),
              detail: "",
              shrinkRefused: false,
            },
          };
        }
        rememberIndex(projectId, parsed.index);
        return {
          ...built,
          state: "ready" as const,
          graphifyVersion: parsed.index.graphifyVersion ?? built.graphifyVersion,
          nodeCount: parsed.index.nodes.filter((node) => !node.external).length,
          edgeCount: parsed.index.edgeCount,
          graphBytes: size,
          error: null,
        };
      });

    const runQueued = (projectId: string) =>
      Effect.gen(function* () {
        // Cancelled or deleted while it waited.
        if (!queued.has(projectId)) return;
        const project = yield* projectOf(projectId).pipe(Effect.option);
        if (Option.isNone(project)) {
          queued.delete(projectId);
          return notify(projectId);
        }
        const { workspaceRoot } = project.value;
        const outDir = outDirOf(projectId);
        yield* Effect.promise(() => NodeFSP.mkdir(outDir, { recursive: true }));
        const hasGraph = (yield* statSize(graphFileOf(projectId))) !== null;
        const [head, fingerprint] = yield* Effect.all(
          [git.head(workspaceRoot), git.treeFingerprint(workspaceRoot)],
          { concurrency: "unbounded" },
        );
        const previous =
          (yield* store.get(projectId).pipe(Effect.orDie)) ?? blankRecord(projectId, workspaceRoot);
        const startedAt = yield* nowIso;

        // The entry stays queued until here so the status never reads idle in between, and a
        // request that arrived meanwhile has merged into it.
        const entry = queued.get(projectId);
        if (entry === undefined) return;
        queued.delete(projectId);
        // `update` needs an earlier build; without one it is a full build.
        const mode = entry.mode === "update" && !hasGraph ? "full" : entry.mode;
        const invocation: GraphifyInvocation =
          mode === "update"
            ? { _tag: "update", root: workspaceRoot, force: false }
            : { _tag: "extract", root: workspaceRoot, outDir, force: mode === "force" };
        const live: ActiveBuild = {
          mode,
          startedAt,
          lastLine: "Starting Graphify",
          process: null,
          cancelled: false,
        };
        active.set(projectId, live);
        yield* store
          .save({ ...previous, workspaceRoot, outDir, state: "building", updatedAt: startedAt })
          .pipe(Effect.orDie);
        notify(projectId);

        let lastNotified = 0;
        const child = yield* startGraphify({
          command: settings.command,
          invocation,
          cwd: workspaceRoot,
          env: graphifyEnvironment(options.env, outDir),
          timeoutMs: options.buildTimeoutMs ?? BUILD_TIMEOUT_MS,
          onLine: (line) => {
            live.lastLine = line;
            // @effect-diagnostics-next-line globalDate:off - a plain Node callback, not Effect code.
            const now = Date.now();
            if (now - lastNotified < PROGRESS_NOTIFY_MS) return;
            lastNotified = now;
            notify(projectId);
          },
        });
        live.process = child;
        // Cancelled while the process was starting.
        if (live.cancelled) yield* child.stop;
        const code = yield* child.exit;
        const updatedAt = yield* nowIso;
        const base = { ...previous, workspaceRoot, outDir, updatedAt };

        let next: GraphRecord;
        if (live.cancelled) {
          next = base;
        } else if (code === 0) {
          next = yield* loadBuilt(projectId, {
            ...base,
            builtAt: updatedAt,
            builtAtCommit: head,
            treeFingerprint: fingerprint,
            graphifyVersion:
              availabilityCache?.value._tag === "available"
                ? availabilityCache.value.version
                : previous.graphifyVersion,
          });
          // A failed load keeps the previous good build's numbers and commit.
          if (next.state === "failed") next = { ...base, state: "failed", error: next.error };
        } else {
          const lines = child.lines();
          const shrinkRefused = isShrinkRefusal(lines);
          next = {
            ...base,
            state: "failed",
            error: {
              summary: shrinkRefused
                ? "The update would remove part of the graph. Rebuild to replace it."
                : code === null
                  ? "Graphify stopped before it finished."
                  : `Graphify exited with code ${code}.`,
              detail: lines.slice(-ERROR_DETAIL_LINES).join("\n"),
              shrinkRefused,
            },
          };
        }
        yield* store.save(next).pipe(Effect.orDie);
        freshness.delete(projectId);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            active.delete(projectId);
            notify(projectId);
          }),
        ),
      );

    /** At most one waiting build per project; a stronger or user request takes its place. */
    const enqueue = (projectId: string, mode: CodeGraphBuildMode, auto: boolean) =>
      Effect.gen(function* () {
        const waiting = queued.get(projectId);
        if (waiting !== undefined) {
          queued.set(projectId, {
            mode: MODE_STRENGTH[mode] > MODE_STRENGTH[waiting.mode] ? mode : waiting.mode,
            auto: waiting.auto && auto,
          });
          return notify(projectId);
        }
        queued.set(projectId, { mode, auto });
        notify(projectId);
        yield* buildLock
          .withPermits(1)(runQueued(projectId))
          .pipe(
            Effect.catchCause((cause) => Effect.logWarning("Code graph build failed", { cause })),
            Effect.forkIn(serviceScope),
          );
      });

    const build = Effect.fn("CodeGraph.build")(function* (
      projectId: ProjectId,
      mode: CodeGraphBuildMode,
    ) {
      yield* projectOf(projectId);
      yield* requireGraphify;
      yield* enqueue(projectId, mode, false);
      return yield* statusOf(projectId);
    });

    const cancel = (projectId: string) =>
      Effect.gen(function* () {
        queued.delete(projectId);
        const live = active.get(projectId);
        if (live) {
          live.cancelled = true;
          if (live.process) yield* live.process.stop;
        }
        notify(projectId);
      });

    /** Deletes the project's graph folder, row and cached index. */
    const forget = (projectId: string) =>
      Effect.gen(function* () {
        yield* cancel(projectId);
        yield* Effect.promise(() =>
          NodeFSP.rm(outDirOf(projectId), { recursive: true, force: true }),
        );
        yield* store.delete(projectId).pipe(Effect.orDie);
        indexes.delete(projectId);
        freshness.delete(projectId);
        lastAutoUpdate.delete(projectId);
        notify(projectId);
      });

    /**
     * Queues an update when automatic updates are on, the project has a graph and it is behind
     * HEAD or the working tree. Never builds a first graph.
     */
    const autoUpdate = (projectId: string) =>
      Effect.gen(function* () {
        if (!settings.autoUpdate) return;
        if (active.has(projectId) || queued.has(projectId)) return;
        const record = yield* store.get(projectId).pipe(Effect.orDie);
        if (record === null || record.builtAt === null) return;
        const now = yield* Clock.currentTimeMillis;
        if (now - (lastAutoUpdate.get(projectId) ?? -Infinity) < AUTO_UPDATE_FLOOR_MS) return;
        const fresh = yield* freshnessOf(record);
        if (!fresh.stale && !fresh.dirty) return;
        if ((yield* availability())._tag === "missing") return;
        lastAutoUpdate.set(projectId, now);
        yield* enqueue(projectId, "update", true);
      });

    // --- Queries ----------------------------------------------------------------------------

    const readGraph = (file: string) =>
      Effect.promise(() =>
        NodeFSP.readFile(file, "utf8").then(
          (text) => {
            try {
              return Index.parseGraph(JSON.parse(text));
            } catch {
              return Index.parseGraph(null);
            }
          },
          () => Index.parseGraph(null),
        ),
      );

    const indexFor = (projectId: string) =>
      Effect.gen(function* () {
        const cached = indexes.get(projectId);
        if (cached) {
          rememberIndex(projectId, cached);
          return cached;
        }
        const file = graphFileOf(projectId);
        const size = yield* statSize(file);
        if (size === null)
          return yield* error(
            "no-graph",
            "No code graph for this project yet. Build one in the Code map panel.",
          );
        if (size > CODE_GRAPH_MAX_GRAPH_BYTES)
          return yield* error(
            "graph-too-large",
            "The graph is larger than 100 MB and was not loaded.",
          );
        const parsed = yield* readGraph(file);
        if (!parsed.ok)
          return yield* error(
            "graph-invalid",
            invalidGraphMessage(parsed.graphifyVersion, parsed.problem),
          );
        rememberIndex(projectId, parsed.index);
        return parsed.index;
      });

    const nodeIn = (index: Index.CodeGraphIndex, nodeId: string) => {
      const node = Index.resolveNode(index, nodeId);
      return node === null
        ? Effect.fail(error("node-not-found", `No symbol or file matches "${nodeId}".`))
        : Effect.succeed(node);
    };

    /** The thread's project and the checkout its files are relative to. */
    const threadCheckout = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const thread = yield* threads
          .getThread(threadId)
          .pipe(Effect.mapError(() => error("project-not-found", "The thread was not found.")));
        const project = yield* projectOf(thread.projectId);
        return {
          projectId: thread.projectId,
          cwd: thread.worktreePath ?? project.workspaceRoot,
          inProjectRoot: thread.worktreePath === null,
        };
      });

    const impactOf = Effect.fn("CodeGraph.impact")(function* (input: CodeGraphImpactInput) {
      const project = yield* projectOf(input.projectId);
      let cwd = project.workspaceRoot;
      if (input.threadId !== undefined) {
        const checkout = yield* threadCheckout(input.threadId);
        if (checkout.projectId !== input.projectId)
          return yield* error("project-not-found", "The thread belongs to another project.");
        cwd = checkout.cwd;
      }
      const index = yield* indexFor(input.projectId);
      const files = input.files ?? (yield* git.changedFiles(cwd));
      const result = Index.impact(index, files, input.depth ?? 2);
      const record = yield* store.get(input.projectId).pipe(Effect.orDie);
      const head = yield* git.head(cwd);
      return {
        ...result,
        stale: record?.builtAtCommit != null && head !== null && head !== record.builtAtCommit,
      } satisfies CodeGraphImpactResult;
    });

    const setAgentTool = Effect.fn("CodeGraph.setAgentTool")(function* (
      projectId: ProjectId,
      enabled: boolean,
    ) {
      const project = yield* projectOf(projectId);
      const record =
        (yield* store.get(projectId).pipe(Effect.orDie)) ??
        blankRecord(projectId, project.workspaceRoot);
      yield* store
        .save({ ...record, agentTool: enabled, updatedAt: yield* nowIso })
        .pipe(Effect.orDie);
      notify(projectId);
      return yield* statusOf(projectId);
    });

    const subscribeStatus = (projectId: ProjectId) =>
      Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const listener = (changed: string) => {
                if (changed === projectId) Queue.offerUnsafe(queue, undefined);
              };
              listeners.add(listener);
              Queue.offerUnsafe(queue, undefined);
              return listener;
            }),
            (listener) => Effect.sync(() => listeners.delete(listener)),
          ),
        // Only the newest status matters; bursts of changes collapse into one read.
        { bufferSize: 1, strategy: "sliding" },
      ).pipe(Stream.mapEffect(() => statusOf(projectId)));

    const list = Effect.gen(function* () {
      const records = yield* store.list().pipe(Effect.orDie);
      const statuses = yield* Effect.forEach(records, (record) =>
        statusOf(record.projectId).pipe(Effect.option),
      );
      return statuses.flatMap((status) => (Option.isSome(status) ? [status.value] : []));
    });

    const updateSettings = Effect.fn("CodeGraph.updateSettings")(function* (
      patch: CodeGraphSettingsPatch,
    ) {
      settings = yield* store.updateSettings(mergeSettings(settings, patch)).pipe(Effect.orDie);
      availabilityCache = null;
      for (const record of yield* store.list().pipe(Effect.orDie)) notify(record.projectId);
      return settings;
    });

    return {
      status: (projectId: ProjectId) => statusOf(projectId),
      /** Re-runs `graphify --version` instead of using the cached answer. */
      checkAvailability: availability(true),
      subscribeStatus,
      list,
      build,
      cancel: (projectId: ProjectId) => cancel(projectId),
      deleteGraph: (projectId: ProjectId) =>
        projectOf(projectId).pipe(Effect.andThen(forget(projectId))),
      summary: (projectId: ProjectId) => indexFor(projectId).pipe(Effect.map(Index.summary)),
      search: (projectId: ProjectId, query: string) =>
        indexFor(projectId).pipe(Effect.map((index) => Index.search(index, query))),
      neighborhood: (projectId: ProjectId, nodeId: string, depth: 1 | 2 = 2) =>
        Effect.gen(function* () {
          const index = yield* indexFor(projectId);
          return Index.neighborhood(index, yield* nodeIn(index, nodeId), depth);
        }),
      impact: impactOf,
      setAgentTool,
      /** Returns at once; the staleness check and any update run in the background. */
      noteProjectOpened: (projectId: ProjectId) =>
        autoUpdate(projectId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Code graph auto-update skipped", { cause }),
          ),
          Effect.forkIn(serviceScope),
          Effect.asVoid,
        ),
      /** After a turn changed files: projects whose root the turn ran in may update. */
      noteThreadChanged: (threadId: ThreadId) =>
        Effect.gen(function* () {
          const checkout = yield* threadCheckout(threadId);
          // A worktree turn leaves the project root, and so its graph, unchanged.
          if (!checkout.inProjectRoot) return;
          freshness.delete(checkout.projectId);
          yield* autoUpdate(checkout.projectId);
        }),
      forgetProject: (projectId: string) => forget(projectId),
      /** Removes graphs of projects deleted while the server was down. */
      forgetMissingProjects: Effect.gen(function* () {
        for (const record of yield* store.list().pipe(Effect.orDie)) {
          if (Option.isNone(yield* projectOf(record.projectId).pipe(Effect.option)))
            yield* forget(record.projectId);
        }
      }),
      getSettings: Effect.sync(() => settings),
      updateSettings,
      /** For the agent tool and other fork services. */
      threadCheckout,
      indexFor,
      graphRecord: (projectId: string) => store.get(projectId).pipe(Effect.orDie),
    };
  });

export const make = Effect.gen(function* () {
  const env = yield* HostProcessEnvironment;
  return yield* makeWith({ env });
});

export class CodeGraphService extends Context.Service<
  CodeGraphService,
  Effect.Success<typeof make>
>()("t3/fork/code-graph/CodeGraphService") {}

export const layer = Layer.effect(CodeGraphService, make).pipe(Layer.provide(ProcessRunner.layer));
