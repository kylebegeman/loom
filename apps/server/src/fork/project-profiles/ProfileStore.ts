import type { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  ProjectProfile,
  ProjectProfileError,
  ProjectProfilesSettings,
  defaultProjectProfile,
  type BudgetStatus,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { applyUsage, crossedLevels } from "./budget.ts";
const profileJson = Schema.fromJsonString(ProjectProfile);
const settingsJson = Schema.fromJsonString(ProjectProfilesSettings);
export const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const get = Effect.fn("ProfileStore.get")(
    function* (projectId: ProjectId) {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_project_profiles_profiles WHERE project_id=${projectId}`;
      return rows[0]
        ? yield* Schema.decodeEffect(profileJson)(rows[0].value_json)
        : defaultProjectProfile(projectId);
    },
    Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })),
  );
  const put = Effect.fn("ProfileStore.put")(
    function* (profile: ProjectProfile) {
      const json = yield* Schema.encodeEffect(profileJson)(profile);
      yield* sql`INSERT INTO fork_project_profiles_profiles (project_id,value_json) VALUES (${profile.projectId},${json}) ON CONFLICT(project_id) DO UPDATE SET value_json=excluded.value_json`;
      return profile;
    },
    Effect.mapError(() => new ProjectProfileError({ reason: "write-failed" })),
  );
  const getSettings = Effect.gen(function* () {
    const rows = yield* sql<{
      value_json: string;
    }>`SELECT value_json FROM fork_project_profiles_settings WHERE key='settings'`;
    if (!rows[0]) return { agentTool: true };
    return yield* Schema.decodeEffect(settingsJson)(rows[0].value_json).pipe(
      Effect.orElseSucceed(() => ({ agentTool: true })),
    );
  }).pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
  const updateSettings = Effect.fn("ProfileStore.updateSettings")(
    function* (settings: ProjectProfilesSettings) {
      const json = yield* Schema.encodeEffect(settingsJson)(settings);
      yield* sql`INSERT INTO fork_project_profiles_settings (key,value_json) VALUES ('settings',${json}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
      return settings;
    },
    Effect.mapError(() => new ProjectProfileError({ reason: "write-failed" })),
  );
  const status = Effect.fn("ProfileStore.budgetStatus")(
    function* (
      profile: ProjectProfile,
      day: string,
      threadId?: ThreadId,
    ): Effect.fn.Return<BudgetStatus, import("effect/sql/SqlError").SqlError> {
      const daily = yield* sql<{
        tokens: number;
      }>`SELECT tokens FROM fork_project_profiles_daily_usage WHERE project_id=${profile.projectId} AND day=${day}`;
      const threads = threadId
        ? yield* sql<{
            tokens: number;
          }>`SELECT tokens FROM fork_project_profiles_thread_usage WHERE thread_id=${threadId}`
        : [];
      return {
        day,
        projectTokensToday: daily[0]?.tokens ?? 0,
        dailyTokens: profile.budgets.dailyTokens,
        thread: threadId
          ? {
              threadId,
              tokens: threads[0]?.tokens ?? 0,
              threadTokens: profile.budgets.threadTokens,
              reported: threads.length > 0,
            }
          : null,
      };
    },
    Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })),
  );
  const recordUsage = Effect.fn("ProfileStore.recordUsage")(function* (input: {
    projectId: ProjectId;
    threadId: ThreadId;
    turnId: string;
    tokens: number;
    sequence: number;
    day: string;
    profile: ProjectProfile;
  }) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* sql<{
          tokens: number;
          sequence: number;
        }>`SELECT tokens,sequence FROM fork_project_profiles_turn_usage WHERE turn_id=${input.turnId}`;
        if (previous[0] && previous[0].sequence >= input.sequence) return;
        const delta = applyUsage(previous[0]?.tokens ?? 0, input.tokens);
        const before = yield* status(input.profile, input.day, input.threadId);
        yield* sql`INSERT INTO fork_project_profiles_turn_usage (turn_id,thread_id,project_id,tokens,sequence) VALUES (${input.turnId},${input.threadId},${input.projectId},${input.tokens},${input.sequence}) ON CONFLICT(turn_id) DO UPDATE SET tokens=excluded.tokens,sequence=excluded.sequence`;
        yield* sql`INSERT INTO fork_project_profiles_thread_usage (thread_id,project_id,tokens) VALUES (${input.threadId},${input.projectId},${delta}) ON CONFLICT(thread_id) DO UPDATE SET tokens=tokens+excluded.tokens`;
        yield* sql`INSERT INTO fork_project_profiles_daily_usage (project_id,day,tokens) VALUES (${input.projectId},${input.day},${delta}) ON CONFLICT(project_id,day) DO UPDATE SET tokens=tokens+excluded.tokens`;
        for (const kind of ["project", "thread"] as const) {
          const tokens =
            kind === "project" ? before.projectTokensToday : (before.thread?.tokens ?? 0);
          const budget =
            kind === "project"
              ? input.profile.budgets.dailyTokens
              : input.profile.budgets.threadTokens;
          for (const level of crossedLevels(tokens, tokens + delta, budget)) {
            const id = `profile-budget:${kind}:${kind === "project" ? `${input.projectId}:${input.day}` : input.threadId}:${level}`;
            const label = kind === "project" ? "Project token budget" : "Thread token budget";
            const message =
              level === 100
                ? `${label} reached${kind === "project" ? " today" : ""}.`
                : `${label} 80% used${kind === "project" ? " today" : ""}.`;
            yield* sql`INSERT OR IGNORE INTO fork_project_profiles_budget_alerts (id,project_id,thread_id,message,day) VALUES (${id},${input.projectId},${input.threadId},${message},${kind === "project" ? input.day : null})`;
          }
        }
      }),
    );
  });
  const cleanup = Effect.fn("ProfileStore.cleanup")(function* () {
    // Project and thread deletions are authoritative in the v2 projections.
    yield* sql`DELETE FROM fork_project_profiles_profiles WHERE project_id NOT IN (SELECT project_id FROM projection_projects WHERE deleted_at IS NULL)`;
    yield* sql`DELETE FROM fork_project_profiles_turn_usage WHERE thread_id NOT IN (SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL)`;
    yield* sql`DELETE FROM fork_project_profiles_thread_usage WHERE thread_id NOT IN (SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL)`;
    yield* sql`DELETE FROM fork_project_profiles_daily_usage WHERE day < date('now','localtime','-90 days') OR project_id NOT IN (SELECT project_id FROM projection_projects WHERE deleted_at IS NULL)`;
    yield* sql`DELETE FROM fork_project_profiles_budget_alerts WHERE day < date('now','localtime','-90 days') OR project_id NOT IN (SELECT project_id FROM projection_projects WHERE deleted_at IS NULL) OR thread_id NOT IN (SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL)`;
  });
  return {
    get,
    put,
    getSettings,
    updateSettings,
    status,
    recordUsage,
    cleanup,
    reset: Effect.fn("ProfileStore.reset")(
      function* (projectId: ProjectId) {
        yield* sql`DELETE FROM fork_project_profiles_profiles WHERE project_id=${projectId}`;
        return defaultProjectProfile(projectId);
      },
      Effect.mapError(() => new ProjectProfileError({ reason: "write-failed" })),
    ),
    cursor: Effect.fn("ProfileStore.cursor")(function* (initial: number) {
      const rows = yield* sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_project_profiles_settings WHERE key='usage-cursor'`;
      if (rows[0]) return Number(rows[0].value_json);
      yield* sql`INSERT INTO fork_project_profiles_settings (key,value_json) VALUES ('usage-cursor',${String(initial)})`;
      return initial;
    }),
    advance: Effect.fn("ProfileStore.advance")(function* (sequence: number) {
      yield* sql`UPDATE fork_project_profiles_settings SET value_json=${String(sequence)} WHERE key='usage-cursor'`;
    }),
    pendingAlerts: sql<{
      id: string;
      thread_id: string;
      message: string;
    }>`SELECT id,thread_id,message FROM fork_project_profiles_budget_alerts WHERE published=0`,
    published: Effect.fn("ProfileStore.published")(function* (id: string) {
      yield* sql`UPDATE fork_project_profiles_budget_alerts SET published=1 WHERE id=${id}`;
    }),
  };
});
