import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

const openDatabaseAsync = vi.hoisted(() => vi.fn());

vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));

import * as MobileDatabase from "./mobile-database";

// fork: library
describe("offline database caches", () => {
  const environmentId = "cached-environment" as import("@t3tools/contracts").EnvironmentId;
  const otherEnvironment = "other-environment" as import("@t3tools/contracts").EnvironmentId;

  async function sqliteDatabase() {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA user_version = 1");
    const database = {
      execAsync: async (sql: string) => {
        sqlite.exec(sql);
      },
      runAsync: async (sql: string, ...args: Array<string | number>) =>
        sqlite.prepare(sql).run(...args),
      getFirstAsync: async (sql: string, ...args: Array<string | number>) =>
        sqlite.prepare(sql).get(...args),
      getAllAsync: async (sql: string, ...args: Array<string | number>) =>
        sqlite.prepare(sql).all(...args),
      withExclusiveTransactionAsync: async (run: (transaction: unknown) => Promise<void>) => {
        await run(database);
      },
      closeAsync: async () => {
        sqlite.close();
      },
    };
    openDatabaseAsync.mockResolvedValueOnce(database);
    return sqlite;
  }

  it.effect("restores saved records and clears them with the environment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.promise(sqliteDatabase);
        const database = yield* MobileDatabase.make;
        yield* database.saveCache(environmentId, "pull-request", "v1:list", 1, '{"entries":[]}');
        yield* database.saveCache(otherEnvironment, "pull-request", "v1:list", 1, "other");
        expect(yield* database.loadCache(environmentId, "pull-request", "v1:list")).toEqual(
          Option.some('{"entries":[]}'),
        );
        yield* database.clearEnvironmentCache(environmentId);
        expect((yield* database.loadCache(environmentId, "pull-request", "v1:list"))._tag).toBe(
          "None",
        );
        expect((yield* database.loadCache(otherEnvironment, "pull-request", "v1:list"))._tag).toBe(
          "Some",
        );
      }),
    ),
  );
  // fork: library
  it.effect(
    "bounds the entire library cache across authorities and expires saved history after seven days",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const now = Date.UTC(2026, 9, 15);
          using _now = vi.spyOn(Date, "now").mockReturnValue(now);
          const sqlite = yield* Effect.promise(sqliteDatabase);
          const database = yield* MobileDatabase.make;
          yield* database.saveCache(environmentId, "pull-request", "pr", 1, "pr");
          yield* database.saveCache(environmentId, "project-library", "old", 1, "old");
          sqlite
            .prepare("UPDATE client_cache SET updated_at = ? WHERE cache_key = 'old'")
            .run(now - 8 * 24 * 60 * 60_000);
          expect((yield* database.loadCache(environmentId, "project-library", "old"))._tag).toBe(
            "None",
          );
          for (let i = 0; i < 205; i++)
            yield* database.saveCache(
              i % 2 ? environmentId : otherEnvironment,
              "project-library",
              `archive-${i}`,
              1,
              "archive",
            );
          expect((yield* database.listCache("project-library")).length).toBe(200);
          const large = "x".repeat(8 * 1024 * 1024);
          for (let i = 0; i < 10; i++)
            yield* database.saveCache(
              i % 2 ? environmentId : otherEnvironment,
              "project-library",
              `large-${i}`,
              1,
              large,
            );
          const rows = yield* database.inspectCaches;
          expect(
            rows
              .filter((row) => row.kind === "project-library")
              .reduce((total, row) => total + row.payloadBytes, 0),
          ).toBeLessThanOrEqual(64 * 1024 * 1024);
          yield* database.saveCache(environmentId, "project-library", "oversized", 1, large + "x");
          expect(
            (yield* database.loadCache(environmentId, "project-library", "oversized"))._tag,
          ).toBe("None");
          expect((yield* database.loadCache(environmentId, "pull-request", "pr"))._tag).toBe(
            "Some",
          );
        }),
      ),
  );
});
