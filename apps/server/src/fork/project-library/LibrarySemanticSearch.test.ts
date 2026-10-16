// @effect-diagnostics nodeBuiltinImport:off -- the timing check appends to a file outside the Effect runtime.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeFS from "node:fs";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { LibraryEmbedder } from "./LibraryEmbedder.ts";
import { leadSnippet, makeLibrarySearch } from "./LibrarySearch.ts";
import {
  LIBRARY_SEMANTIC_SEARCH_SCHEMA,
  SEMANTIC_DEPTH,
  fuseRankings,
  makeLibrarySemanticSearch,
  quantizeEmbedding,
  storedSimilarity,
} from "./LibrarySemanticSearch.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

// Set to a file path to run the 60,000-item timing check and append its timings there.
const benchOutput = process.env.LOOM_SEMANTIC_BENCH;

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );
const unit = (values: ReadonlyArray<number>) => {
  const norm = Math.hypot(...values);
  return Float32Array.from(values, (value) => value / norm);
};
// A fixed pseudo-random sequence, so every run checks the same vectors.
let seed = 1;
const next = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};
const randomUnit = (dimensions: number) =>
  unit(Array.from({ length: dimensions }, () => next() * 2 - 1));

describe("Library semantic ranking", () => {
  it("stores vectors in a byte per value without moving their similarity", () => {
    for (let trial = 0; trial < 20; trial++) {
      const a = randomUnit(384);
      const b = randomUnit(384);
      const { scale, bytes } = quantizeEmbedding(b);
      expect(bytes.byteLength).toBe(384);
      const exact = a.reduce((sum, value, index) => sum + value * b[index]!, 0);
      expect(Math.abs(storedSimilarity(a, scale, bytes) - exact)).toBeLessThan(0.01);
    }
    const zero = quantizeEmbedding(new Float32Array(4));
    expect(storedSimilarity(unit([1, 0, 0, 0]), zero.scale, zero.bytes)).toBe(0);
  });

  it("blends two rankings by reciprocal rank, favouring items both found", () => {
    const fused = fuseRankings([1, 2, 3], [3, 4, 1]);
    expect(fused.map(({ id }) => id)).toEqual([1, 3, 2, 4]);
    expect(fused.map(({ text, semantic }) => [text, semantic])).toEqual([
      [true, true],
      [true, true],
      [true, false],
      [false, true],
    ]);
    // Equal scores keep the lower id first; repeated ids count once.
    expect(fuseRankings([7, 7], [5]).map(({ id }) => id)).toEqual([5, 7]);
  });

  it("shows the start of an item as the snippet of a meaning match", () => {
    expect(leadSnippet("  Why did\n\nthe rollout   stall?  ")).toBe("Why did the rollout stall?");
    const long = leadSnippet(`${"rollout ".repeat(40)}end`);
    expect(long.endsWith("rollout…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(161);
  });

  it.effect("creates its storage idempotently, so the migration can be renumbered", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        for (const statement of LIBRARY_SEMANTIC_SEARCH_SCHEMA) yield* sql.unsafe(statement);
        const objects = yield* sql<{ name: string }>`
          SELECT name FROM sqlite_master WHERE name LIKE 'fork_library_search_vectors%' ORDER BY name`;
        expect(objects.map(({ name }) => name)).toEqual([
          "fork_library_search_vectors",
          "fork_library_search_vectors_item_delete",
          "fork_library_search_vectors_item_update",
        ]);
      }),
    ),
  );
});

describe.skipIf(!benchOutput)("Library semantic search at 60,000 items", () => {
  it.live(
    "answers within budget",
    () =>
      withDatabase(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runForkMigrationSet(ProjectLibraryMigrations);
          yield* sql`INSERT INTO fork_library_projects VALUES ('p', 1, 0, '{}', '2026-10-01', '2026-10-01')`;
          yield* sql`INSERT INTO fork_library_threads (library_id, source_environment_id, source_thread_id, project_id, source_sequence, summary_json, payload_json, updated_at)
            VALUES ('lib', 'env', 'thread', 'p', 1, '{"title":"Bench"}', '{}', '2026-10-01')`;
          yield* sql`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 60000)
            INSERT INTO fork_library_search_items (library_id, position, item_id, role, occurred_at, body)
            SELECT 'lib', x, 'item-' || x, 'user', '2026-10-01T00:00:00.000Z',
              'note ' || (x % 997) || ' about topic ' || (x % 37) || CASE WHEN x % 50 = 0 THEN ' deploy' ELSE '' END
            FROM n`;
          yield* sql`INSERT INTO fork_library_search_vectors (id, model, scale, vector)
            SELECT id, 'bench', 0.0001, randomblob(384) FROM fork_library_search_items`;
          const query = randomUnit(384);
          const embedder = { model: "bench", embed: () => Effect.succeed(query) };
          const semantic = yield* makeLibrarySemanticSearch(embedder);
          const search = yield* makeLibrarySearch.pipe(
            Effect.provideService(LibraryEmbedder, embedder),
          );
          const median = Effect.fnUntraced(function* <A, E>(effect: Effect.Effect<A, E>) {
            const times: number[] = [];
            for (let run = 0; run < 7; run++) {
              const start = performance.now();
              yield* effect;
              times.push(performance.now() - start);
            }
            return times.toSorted((a, b) => a - b)[3]!;
          });
          const nearest = yield* median(semantic.nearest(query, sql`1 = 1`));
          const blended = yield* median(search.search({ query: "deploy", limit: 20 }));
          const words = yield* median(
            search.search({ query: "deploy", limit: 20, semantic: false }),
          );
          const page = yield* search.search({ query: "deploy", limit: 20 });
          expect(page.hits).toHaveLength(20);
          expect(SEMANTIC_DEPTH).toBe(100);
          NodeFS.appendFileSync(
            benchOutput!,
            `${JSON.stringify({ items: 60_000, nearestMs: nearest, blendedMs: blended, wordsMs: words })}\n`,
          );
          expect(blended).toBeLessThan(1_000);
        }),
      ),
    120_000,
  );
});
