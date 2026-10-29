import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { defaultProjectProfile } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectProfilesMigrations } from "./migrations.ts";
import { makeStore } from "./ProfileStore.ts";
const projectId = ProjectId.make("project"),
  threadId = ThreadId.make("thread");
describe("private project profiles storage", () => {
  it.effect("migrates separately, stores validated profiles, resets and defaults sharing on", () =>
    Effect.gen(function* () {
      yield* runForkMigrationSet(ProjectProfilesMigrations);
      expect(yield* runForkMigrationSet(ProjectProfilesMigrations)).toEqual([]);
      const store = yield* makeStore;
      expect(yield* store.get(projectId)).toEqual(defaultProjectProfile(projectId));
      expect(yield* store.getSettings).toEqual({ agentTool: true });
      const profile = {
        ...defaultProjectProfile(projectId),
        agentNotes: "Private notes",
        agentToolFamilies: {
          hardware: "always" as const,
          reach: "never" as const,
          sites: "auto" as const,
        },
        commands: { test: { _tag: "command" as const, command: "vp test" } },
      };
      yield* store.put(profile);
      expect(yield* store.get(projectId)).toEqual(profile);
      yield* store.updateSettings({ agentTool: false });
      expect(yield* store.getSettings).toEqual({ agentTool: false });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE fork_project_profiles_settings SET value_json='invalid' WHERE key='settings'`;
      expect(yield* store.getSettings).toEqual({ agentTool: true });
      expect(yield* store.reset(projectId)).toEqual(defaultProjectProfile(projectId));
    }).pipe(Effect.provide(layerMemory)),
  );
  it.effect(
    "commits usage once per sequence, handles session reset and durable threshold outbox",
    () =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectProfilesMigrations);
        const store = yield* makeStore;
        const profile = {
          ...defaultProjectProfile(projectId),
          budgets: { dailyTokens: 100, threadTokens: 100 },
        };
        const input = { projectId, threadId, turnId: "turn", day: "2026-10-22", profile };
        yield* store.recordUsage({ ...input, tokens: 90, sequence: 1 });
        expect((yield* store.pendingAlerts).map((a) => a.message)).toEqual([
          "Project token budget 80% used today.",
          "Thread token budget 80% used.",
        ]);
        yield* store.recordUsage({ ...input, tokens: 90, sequence: 1 });
        yield* store.recordUsage({ ...input, tokens: 110, sequence: 2 });
        yield* store.recordUsage({ ...input, tokens: 5, sequence: 3 });
        expect(yield* store.status(profile, input.day, threadId)).toMatchObject({
          projectTokensToday: 115,
          thread: { tokens: 115, reported: true },
        });
        expect((yield* store.pendingAlerts).length).toBe(4);
        for (const alert of yield* store.pendingAlerts) yield* store.published(alert.id);
        expect(yield* store.pendingAlerts).toEqual([]);
        yield* store.recordUsage({
          ...input,
          turnId: "next-turn",
          day: "2026-10-23",
          tokens: 100,
          sequence: 4,
        });
        expect((yield* store.pendingAlerts).map((a) => a.message)).toEqual([
          "Project token budget 80% used today.",
          "Project token budget reached today.",
        ]);
        expect((yield* store.status(profile, "2026-10-23", threadId)).thread?.tokens).toBe(215);
      }).pipe(Effect.provide(layerMemory)),
  );
});
