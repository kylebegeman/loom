// @effect-diagnostics nodeBuiltinImport:off - Runs a stub Graphify against a scratch git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Config from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeWith } from "./CodeGraphService.ts";
import { CodeGraphMigrations } from "./migrations.ts";

/** Unused service methods fail immediately instead of silently returning a fake value. */
function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const projectId = ProjectId.make("project-graph");
const rootThread = ThreadId.make("thread-root");
const worktreeThread = ThreadId.make("thread-worktree");
const FIXTURE = new URL("./__fixtures__/graph.small.json", import.meta.url).pathname;
/** Files of the fixture graph that also exist in the scratch repository. */
const SOURCE_FILES = ["src/DeviceQaService.ts", "src/hostDevices.ts", "src/hostDevices.test.ts"];

const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/**
 * A stub Graphify that logs its arguments. `extract` writes the fixture graph; `update` refuses
 * to shrink when `<home>/refuse` exists; `<home>/slow` makes any build hang until stopped.
 */
const writeGraphify = (home: string) => {
  const path = NodePath.join(home, "graphify");
  NodeFS.writeFileSync(
    path,
    `#!/bin/sh
echo "$1" >> '${home}/calls'
case "$1" in
  --version) echo "graphify 0.9.83"; exit 0 ;;
esac
if [ -f '${home}/slow' ]; then echo "Scanning"; exec sleep 30; fi
case "$1" in
  extract) echo "Scanning files"; cp '${FIXTURE}' "$GRAPHIFY_OUT/graph.json" ;;
  update)
    if [ -f '${home}/refuse' ]; then
      echo "[graphify] WARNING: new graph has 10 nodes but existing graph.json has 177 (net -167). Refusing to overwrite."
      exit 1
    fi
    echo "Code graph updated." ;;
esac
`,
    { mode: 0o755 },
  );
  return path;
};

const setup = (options: { readonly graphify?: string } = {}) =>
  Effect.gen(function* () {
    const home = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-graph-")),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
    );
    const repo = NodePath.join(home, "repo");
    NodeFS.mkdirSync(NodePath.join(repo, "src"), { recursive: true });
    for (const file of SOURCE_FILES) NodeFS.writeFileSync(NodePath.join(repo, file), "// v1\n");
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    const graphify = options.graphify ?? writeGraphify(home);
    const stateDir = NodePath.join(home, "state");
    let projectExists = true;

    const context = yield* Layer.build(
      Layer.mergeAll(
        Config.layerTest(home, stateDir),
        SqlitePersistenceMemory,
        ProcessRunner.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    );
    yield* runForkMigrationSet(CodeGraphMigrations).pipe(Effect.provide(context));
    const service = yield* makeWith({ env: { PATH: process.env.PATH }, freshnessTtlMs: 0 }).pipe(
      Effect.provide(context),
      Effect.provideService(
        ProjectionStore.ProjectionStoreV2,
        partial<ProjectionStore.ProjectionStoreV2["Service"]>({
          getThread: (id) =>
            Effect.succeed({
              id,
              projectId,
              worktreePath: id === worktreeThread ? NodePath.join(home, "worktree") : null,
            } as unknown as OrchestrationV2AppThread),
        }),
      ),
      Effect.provideService(
        ProjectStore.ProjectStoreV2,
        partial<ProjectStore.ProjectStoreV2["Service"]>({
          get: () =>
            Effect.succeed(
              projectExists
                ? Option.some({ projectId, title: "Repo", workspaceRoot: repo } as never)
                : Option.none(),
            ),
        }),
      ),
    );
    yield* service.updateSettings({ command: [graphify] });

    /** The status once nothing is queued or building. */
    const idle = service.subscribeStatus(projectId).pipe(
      Stream.filter((status) => status.state !== "building" && !status.queued),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.timeout("20 seconds"),
    );
    const building = service.subscribeStatus(projectId).pipe(
      Stream.filter((status) => status.state === "building"),
      Stream.runHead,
      Effect.timeout("20 seconds"),
    );
    const calls = () =>
      NodeFS.existsSync(NodePath.join(home, "calls"))
        ? NodeFS.readFileSync(NodePath.join(home, "calls"), "utf8").trim().split("\n")
        : [];
    const commit = (file: string, text: string) => {
      NodeFS.writeFileSync(NodePath.join(repo, file), text);
      git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", text);
    };
    return {
      home,
      repo,
      stateDir,
      service,
      idle,
      building,
      calls,
      commit,
      removeProject: () => {
        projectExists = false;
      },
    };
  });

describe("CodeGraphService", () => {
  it.live("reports a missing Graphify with the pinned install command", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup({ graphify: "/nonexistent/graphify" });
        const status = yield* t.service.status(projectId);
        expect(status.availability).toMatchObject({ _tag: "missing" });
        expect(status.availability).toHaveProperty(
          "installHint",
          expect.stringContaining("0.9.83"),
        );
        const error = yield* Effect.flip(t.service.build(projectId, "full"));
        expect(error.reason).toBe("graphify-missing");
      }),
    ),
  );

  it.live("builds a graph outside the repository and answers queries from it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        expect((yield* t.service.status(projectId)).state).toBe("none");
        expect((yield* Effect.flip(t.service.summary(projectId))).reason).toBe("no-graph");

        yield* t.service.build(projectId, "full");
        const status = yield* t.idle;
        expect(status).toMatchObject({
          state: "ready",
          builtAtCommit: git(t.repo, "rev-parse", "HEAD"),
          stale: false,
          dirty: false,
          nodeCount: 177,
          availability: { _tag: "available", version: "0.9.83", tested: true },
        });
        const outDir = (yield* t.service.graphRecord(projectId))!.outDir;
        expect(outDir.startsWith(t.stateDir)).toBe(true);
        expect(NodeFS.existsSync(NodePath.join(outDir, "graph.json"))).toBe(true);
        expect(NodeFS.readdirSync(t.repo)).not.toContain("graphify-out");

        expect((yield* t.service.summary(projectId)).fileCount).toBeGreaterThan(0);
        const found = yield* t.service.search(projectId, "pngInfo");
        expect(found.nodes[0]?.label).toBe("pngInfo()");

        // Uncommitted changes seed the impact and mark the graph dirty.
        NodeFS.writeFileSync(NodePath.join(t.repo, "src/hostDevices.ts"), "// v2\n");
        const impact = yield* t.service.impact({ projectId });
        expect(impact.seedFiles).toEqual(["src/hostDevices.ts"]);
        expect(impact.stale).toBe(false);
        expect((yield* t.service.status(projectId)).dirty).toBe(true);

        t.commit("src/hostDevices.ts", "// v3\n");
        expect((yield* t.service.status(projectId)).stale).toBe(true);
      }),
    ),
  );

  it.live("keeps the previous graph when an update refuses to shrink it, until a rebuild", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.service.build(projectId, "full");
        yield* t.idle;

        NodeFS.writeFileSync(NodePath.join(t.home, "refuse"), "");
        yield* t.service.build(projectId, "update");
        const failed = yield* t.idle;
        expect(failed).toMatchObject({
          state: "failed",
          nodeCount: 177,
          error: { shrinkRefused: true },
        });
        expect(failed.error?.detail).toContain("Refusing to overwrite");
        expect((yield* t.service.search(projectId, "pngInfo")).nodes).not.toHaveLength(0);

        yield* t.service.build(projectId, "force");
        expect(yield* t.idle).toMatchObject({ state: "ready", error: null });
        expect(t.calls().filter((call) => call !== "--version")).toEqual([
          "extract",
          "update",
          "extract",
        ]);
      }),
    ),
  );

  it.live("cancels a running build and returns to the previous state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        NodeFS.writeFileSync(NodePath.join(t.home, "slow"), "");
        yield* t.service.build(projectId, "full");
        yield* t.building;
        yield* t.service.cancel(projectId);
        expect(yield* t.idle).toMatchObject({ state: "none", error: null, progress: null });
      }),
    ),
  );

  it.live("updates automatically after a project-root turn, never for a worktree turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.service.build(projectId, "full");
        yield* t.idle;
        t.commit("src/hostDevices.ts", "// v2\n");

        // Off by default.
        yield* t.service.noteThreadChanged(rootThread);
        yield* t.service.updateSettings({ autoUpdate: true });
        yield* t.service.noteThreadChanged(worktreeThread);
        expect((yield* t.service.status(projectId)).queued).toBe(false);

        yield* t.service.noteThreadChanged(rootThread);
        expect(yield* t.idle).toMatchObject({
          state: "ready",
          builtAtCommit: git(t.repo, "rev-parse", "HEAD"),
          stale: false,
        });
        expect(t.calls().filter((call) => call !== "--version")).toEqual(["extract", "update"]);
      }),
    ),
  );

  it.live("deletes a graph, and forgets projects that no longer exist", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const t = yield* setup();
        yield* t.service.build(projectId, "full");
        yield* t.idle;
        expect((yield* t.service.setAgentTool(projectId, true)).agentTool).toBe(true);
        const outDir = (yield* t.service.graphRecord(projectId))!.outDir;

        yield* t.service.deleteGraph(projectId);
        expect(NodeFS.existsSync(outDir)).toBe(false);
        expect(yield* t.service.status(projectId)).toMatchObject({
          state: "none",
          agentTool: false,
        });

        yield* t.service.build(projectId, "full");
        yield* t.idle;
        t.removeProject();
        yield* t.service.forgetMissingProjects;
        expect(NodeFS.existsSync(outDir)).toBe(false);
        expect(yield* t.service.list).toEqual([]);
      }),
    ),
  );
});
