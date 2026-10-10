import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_CODE_GRAPH_SETTINGS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeCodeGraphStore, type CodeGraphStore, type GraphRecord } from "./CodeGraphStore.ts";
import { CodeGraphMigrations } from "./migrations.ts";

const record = (projectId: string, fields: Partial<GraphRecord> = {}): GraphRecord => ({
  projectId,
  workspaceRoot: `/work/${projectId}`,
  outDir: `/state/fork/code-graph/${projectId}`,
  state: "ready",
  builtAt: "2026-10-09T10:00:00.000Z",
  builtAtCommit: "abc123",
  treeFingerprint: "",
  graphifyVersion: "0.9.83",
  nodeCount: 203,
  edgeCount: 456,
  graphBytes: 180_000,
  agentTool: false,
  error: null,
  updatedAt: "2026-10-09T10:00:00.000Z",
  ...fields,
});

const withStore = <A, E>(
  use: (store: CodeGraphStore) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(CodeGraphMigrations);
    return yield* use(yield* makeCodeGraphStore);
  }).pipe(Effect.provide(SqlitePersistenceMemory));

describe("CodeGraphStore", () => {
  it.effect("round-trips a project's graph, its error and its agent switch", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const failed = record("p1", {
          state: "failed",
          agentTool: true,
          error: { summary: "Graphify exited with code 1", detail: "boom", shrinkRefused: true },
        });
        yield* store.save(failed);
        yield* store.save(record("p2"));
        expect(yield* store.get("p1")).toEqual(failed);
        expect((yield* store.list()).map((row) => row.projectId)).toEqual(["p1", "p2"]);
        yield* store.delete("p1");
        expect(yield* store.get("p1")).toBeNull();
      }),
    ),
  );

  it.effect("resets builds a previous server left running", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.save(record("built", { state: "building" }));
        yield* store.save(record("first", { state: "building", builtAt: null }));
        yield* store.resetBuilding("2026-10-09T11:00:00.000Z");
        expect((yield* store.get("built"))?.state).toBe("ready");
        expect((yield* store.get("first"))?.state).toBe("none");
      }),
    ),
  );

  it.effect("keeps settings and fills fields it has never stored with defaults", () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.getSettings()).toEqual(DEFAULT_CODE_GRAPH_SETTINGS);
        const next = {
          command: ["uvx", "--from", "graphifyy==0.9.83", "graphify"],
          autoUpdate: true,
        };
        yield* store.updateSettings(next);
        expect(yield* store.getSettings()).toEqual(next);
      }),
    ),
  );
});
