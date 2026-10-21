import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_LIBRARY_STATUS_FRESH_MS,
  BotDefinitionInput,
  BotLibraryError,
  BotLibraryStatusReport,
  BotRemoteMessage,
  BotRemoteUpdate,
  LIBRARY_REPLY_WAIT_MAX_MS,
  type BotLibraryAckRequest,
  type BotLibraryDelivery,
  type BotLibraryListResult,
  type BotLibraryPublishRequest,
  type BotLibraryRecord,
  type BotLibraryResultAck,
  type BotLibraryResultPost,
  type BotLibrarySubmitRequest,
  type BotLibraryTargetStatus,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { forkParked } from "../../serverActivation.ts";
import { isoAt } from "../preview-links/policy.ts";

const LEASE_MS = 2 * 60_000;
const BATCH = 20;
const LIST_LIMIT = 200;
/** A run nobody picked up by then fails, so its requester stops waiting. */
const PICKUP_MS = 10 * 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const SWEEP_INTERVAL = Duration.minutes(5);

const definitionJson = Schema.fromJsonString(BotDefinitionInput);
const decodeDefinition = Schema.decodeUnknownOption(definitionJson);
const encodeDefinition = Schema.encodeEffect(definitionJson);
const reportJson = Schema.fromJsonString(BotLibraryStatusReport);
const decodeReport = Schema.decodeUnknownOption(reportJson);
const encodeReport = Schema.encodeEffect(reportJson);
const messageJson = Schema.fromJsonString(BotRemoteMessage);
const decodeMessage = Schema.decodeUnknownOption(messageJson);
const encodeMessage = Schema.encodeEffect(messageJson);
const updateJson = Schema.fromJsonString(BotRemoteUpdate);
const decodeUpdate = Schema.decodeUnknownOption(updateJson);
const encodeUpdate = Schema.encodeEffect(updateJson);

interface BotRow {
  readonly id: string;
  readonly revision: number;
  readonly seq: number;
  readonly definition_json: string | null;
  readonly project_id: string | null;
  readonly updated_by: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

interface StatusRow {
  readonly environment_id: string;
  readonly report_json: string;
  readonly reported_at: string;
}

interface RequestRow {
  readonly id: string;
  readonly from_env: string;
  readonly target_env: string;
  readonly message_json: string;
  readonly state: string;
  readonly created_at: string;
  readonly leased_until: string | null;
}

interface ResultRow {
  readonly request_id: string;
  readonly seq: number;
  readonly update_json: string;
}

const toRecord = (row: BotRow): BotLibraryRecord => {
  const definition =
    row.definition_json === null ? Option.none() : decodeDefinition(row.definition_json);
  return {
    id: row.id,
    revision: row.revision,
    seq: row.seq,
    definition: Option.getOrNull(definition),
    libraryProjectId: row.project_id as BotLibraryRecord["libraryProjectId"],
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
};

const storageFailure = (cause: SqlError | Schema.SchemaError) =>
  Effect.logWarning("The Library's bot storage failed", cause).pipe(
    Effect.andThen(
      Effect.fail(
        new BotLibraryError({
          reason: "storage",
          message: "The Library could not reach its bot storage.",
        }),
      ),
    ),
  );

const refused = (message: string) => new BotLibraryError({ reason: "refused", message });

export class BotLibraryService extends Context.Service<
  BotLibraryService,
  {
    /** False unless this computer is the Library; every method then fails `unavailable`. */
    readonly enabled: boolean;
    readonly publish: (
      environmentId: EnvironmentId,
      request: BotLibraryPublishRequest,
    ) => Effect.Effect<BotLibraryRecord, BotLibraryError>;
    readonly unpublish: (
      environmentId: EnvironmentId,
      libraryBotId: string,
      label: string,
    ) => Effect.Effect<void, BotLibraryError>;
    readonly list: (after: number) => Effect.Effect<BotLibraryListResult, BotLibraryError>;
    readonly reportStatus: (
      environmentId: EnvironmentId,
      report: BotLibraryStatusReport,
    ) => Effect.Effect<void, BotLibraryError>;
    readonly targets: Effect.Effect<ReadonlyArray<BotLibraryTargetStatus>, BotLibraryError>;
    readonly submit: (
      environmentId: EnvironmentId,
      request: BotLibrarySubmitRequest,
    ) => Effect.Effect<void, BotLibraryError>;
    readonly nextRequests: (
      environmentId: EnvironmentId,
      waitMs: number,
    ) => Effect.Effect<ReadonlyArray<BotLibraryDelivery>, BotLibraryError>;
    readonly ack: (
      environmentId: EnvironmentId,
      ack: BotLibraryAckRequest,
    ) => Effect.Effect<void, BotLibraryError>;
    /** True when the run was withdrawn before its target took it, so it never runs. */
    readonly cancel: (
      environmentId: EnvironmentId,
      requestId: string,
    ) => Effect.Effect<boolean, BotLibraryError>;
    readonly postResult: (
      environmentId: EnvironmentId,
      post: BotLibraryResultPost,
    ) => Effect.Effect<void, BotLibraryError>;
    readonly nextResults: (
      environmentId: EnvironmentId,
      waitMs: number,
    ) => Effect.Effect<ReadonlyArray<BotLibraryResultPost>, BotLibraryError>;
    readonly ackResult: (
      environmentId: EnvironmentId,
      ack: BotLibraryResultAck,
    ) => Effect.Effect<void, BotLibraryError>;
  }
>()("t3/fork/bots/BotLibraryService") {}

/** One signal per computer and queue. A wait that times out leaves its signal for the next one. */
const makeSignals = () => {
  const waiters = new Map<string, Deferred.Deferred<void>>();
  return {
    waiterFor: (key: string) =>
      Effect.sync(() => {
        const existing = waiters.get(key);
        if (existing !== undefined) return existing;
        const signal = Deferred.makeUnsafe<void>();
        waiters.set(key, signal);
        return signal;
      }),
    wake: (key: string) =>
      Effect.suspend(() => {
        const signal = waiters.get(key);
        if (signal === undefined) return Effect.void;
        waiters.delete(key);
        return Deferred.succeed(signal, undefined);
      }),
  };
};

const clampWait = (waitMs: number) =>
  Number.isFinite(waitMs)
    ? Math.min(Math.max(Math.trunc(waitMs), 0), LIBRARY_REPLY_WAIT_MAX_MS)
    : 0;

const make = Effect.gen(function* () {
  const enabled = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  const sql = yield* SqlClient.SqlClient;
  // Reads skip it; every write and lease takes it so revisions and leases stay exact.
  const lock = yield* Semaphore.make(1);
  const requestSignals = makeSignals();
  const resultSignals = makeSignals();
  const requireEnabled = enabled
    ? Effect.void
    : Effect.fail(
        new BotLibraryError({
          reason: "unavailable",
          message: "This Library does not share bots.",
        }),
      );

  const statusOf = (environmentId: string) =>
    sql<StatusRow>`SELECT * FROM fork_bots_library_status WHERE environment_id = ${environmentId}`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        if (row === undefined) return null;
        const report = decodeReport(row.report_json);
        return Option.isSome(report) ? { report: report.value, reportedAt: row.reported_at } : null;
      }),
    );
  const labelOf = (environmentId: string) =>
    statusOf(environmentId).pipe(
      Effect.map((status) => status?.report.label ?? "The other computer"),
    );

  /** Posts a result for the requester; a repeated post of the same seq is ignored. */
  const insertResult = Effect.fnUntraced(function* (
    requestId: string,
    seq: number,
    toEnv: string,
    update: BotRemoteUpdate,
    now: number,
  ) {
    const json = yield* encodeUpdate(update);
    yield* sql`INSERT INTO fork_bots_library_results (request_id, seq, to_env, update_json, created_at)
      VALUES (${requestId}, ${seq}, ${toEnv}, ${json}, ${isoAt(now)})
      ON CONFLICT (request_id, seq) DO NOTHING`;
    yield* resultSignals.wake(toEnv);
  });
  const failRun = (requestId: string, toEnv: string, label: string, error: string, now: number) =>
    insertResult(
      requestId,
      2,
      toEnv,
      {
        _tag: "terminal",
        label,
        status: "failed",
        startedAt: null,
        finishedAt: isoAt(now),
        result: null,
        resultTruncated: false,
        error,
        verdict: null,
        usage: null,
        modelSelection: null,
      },
      now,
    );

  const publish = Effect.fn("BotLibraryService.publish")(
    function* (_environmentId: EnvironmentId, request: BotLibraryPublishRequest) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const id = request.definition.id;
      const existing =
        (yield* sql<BotRow>`SELECT * FROM fork_bots_library_bots WHERE id = ${id}`)[0];
      const live = existing !== undefined && existing.deleted_at === null;
      if (request.expectedRevision === null && live)
        return yield* new BotLibraryError({
          reason: "conflict",
          message: `A bot named ${id} is already shared. Rename this one to share it.`,
        });
      if (request.expectedRevision !== null && !live)
        return yield* new BotLibraryError({
          reason: "not_found",
          message: `${request.definition.name} is no longer shared.`,
        });
      if (
        request.expectedRevision !== null &&
        existing !== undefined &&
        existing.revision !== request.expectedRevision
      )
        return yield* new BotLibraryError({
          reason: "conflict",
          message: `${existing.updated_by} changed ${request.definition.name} after this computer last synced it. Sync, then save again.`,
        });
      const stored =
        live && request.keepModel === true && existing.definition_json !== null
          ? decodeDefinition(existing.definition_json)
          : Option.none();
      const definition = Option.isSome(stored)
        ? { ...request.definition, modelSelection: stored.value.modelSelection }
        : request.definition;
      const json = yield* encodeDefinition(definition);
      const seq =
        ((yield* sql<{ seq: number | null }>`SELECT MAX(seq) AS seq FROM fork_bots_library_bots`)[0]
          ?.seq ?? 0) + 1;
      const revision = (existing?.revision ?? 0) + 1;
      yield* sql`INSERT INTO fork_bots_library_bots (id, revision, seq, definition_json, project_id, updated_by, updated_at, deleted_at)
        VALUES (${id}, ${revision}, ${seq}, ${json}, ${request.libraryProjectId}, ${request.label}, ${isoAt(now)}, NULL)
        ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, seq = excluded.seq,
          definition_json = excluded.definition_json, project_id = excluded.project_id,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at, deleted_at = NULL`;
      return toRecord({
        id,
        revision,
        seq,
        definition_json: json,
        project_id: request.libraryProjectId,
        updated_by: request.label,
        updated_at: isoAt(now),
        deleted_at: null,
      });
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure, SchemaError: storageFailure }),
  );

  const unpublish = Effect.fn("BotLibraryService.unpublish")(
    function* (_environmentId: EnvironmentId, libraryBotId: string, label: string) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const seq =
        ((yield* sql<{ seq: number | null }>`SELECT MAX(seq) AS seq FROM fork_bots_library_bots`)[0]
          ?.seq ?? 0) + 1;
      yield* sql`UPDATE fork_bots_library_bots SET seq = ${seq}, definition_json = NULL,
        updated_by = ${label}, updated_at = ${isoAt(now)}, deleted_at = ${isoAt(now)}
        WHERE id = ${libraryBotId} AND deleted_at IS NULL`;
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const list = Effect.fn("BotLibraryService.list")(
    function* (after: number) {
      yield* requireEnabled;
      const rows = yield* sql<BotRow>`SELECT * FROM fork_bots_library_bots WHERE seq > ${after}
        ORDER BY seq LIMIT ${LIST_LIMIT}`;
      return {
        records: rows.map(toRecord),
        cursor: rows.length === 0 ? after : rows[rows.length - 1]!.seq,
      };
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const reportStatus = Effect.fn("BotLibraryService.reportStatus")(
    function* (environmentId: EnvironmentId, report: BotLibraryStatusReport) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const json = yield* encodeReport(report);
      yield* sql`INSERT INTO fork_bots_library_status (environment_id, report_json, reported_at)
        VALUES (${environmentId}, ${json}, ${isoAt(now)})
        ON CONFLICT (environment_id) DO UPDATE SET report_json = excluded.report_json,
          reported_at = excluded.reported_at`;
    },
    Effect.catchTags({ SqlError: storageFailure, SchemaError: storageFailure }),
  );

  const targets = Effect.gen(function* () {
    yield* requireEnabled;
    const rows = yield* sql<StatusRow>`SELECT * FROM fork_bots_library_status`;
    return rows.flatMap((row): ReadonlyArray<BotLibraryTargetStatus> => {
      const report = decodeReport(row.report_json);
      return Option.isSome(report)
        ? [
            {
              environmentId: row.environment_id as EnvironmentId,
              report: report.value,
              reportedAt: row.reported_at,
            },
          ]
        : [];
    });
  }).pipe(Effect.catchTags({ SqlError: storageFailure }));

  const submit = Effect.fn("BotLibraryService.submit")(
    function* (environmentId: EnvironmentId, input: BotLibrarySubmitRequest) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const target = input.targetEnvironmentId;
      if (target === environmentId)
        return yield* new BotLibraryError({
          reason: "invalid",
          message: "A computer runs its own bots without the Library.",
        });
      const status = yield* statusOf(target);
      if (status === null || now - Date.parse(status.reportedAt) > BOT_LIBRARY_STATUS_FRESH_MS)
        return yield* refused(`${status?.report.label ?? "That computer"} is offline.`);
      const label = status.report.label;
      if (!status.report.acceptRemote)
        return yield* refused(`${label} does not run bots for other computers.`);
      const bot = status.report.bots.find(
        (entry) => entry.libraryBotId === input.request.libraryBotId,
      );
      if (bot === undefined || !bot.ready)
        return yield* refused([`${label} cannot run this bot.`, ...(bot?.reasons ?? [])].join(" "));
      const json = yield* encodeMessage({ _tag: "run", request: input.request });
      yield* sql`INSERT INTO fork_bots_library_requests (id, from_env, target_env, message_json, state, created_at)
        VALUES (${input.request.requestId}, ${environmentId}, ${target}, ${json}, 'pending', ${isoAt(now)})
        ON CONFLICT (id) DO NOTHING`;
      yield* requestSignals.wake(target);
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure, SchemaError: storageFailure }),
  );

  const leaseRequests = (environmentId: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const rows = yield* sql<RequestRow>`SELECT * FROM fork_bots_library_requests
          WHERE target_env = ${environmentId} AND state = 'pending'
            AND (leased_until IS NULL OR leased_until <= ${isoAt(now)})
          ORDER BY created_at LIMIT ${BATCH}`;
        const deliveries: Array<BotLibraryDelivery> = [];
        for (const row of rows) {
          yield* sql`UPDATE fork_bots_library_requests SET leased_until = ${isoAt(now + LEASE_MS)}
            WHERE id = ${row.id}`;
          const message = decodeMessage(row.message_json);
          if (Option.isSome(message))
            deliveries.push({
              messageId: row.id,
              fromEnvironmentId: row.from_env as EnvironmentId,
              message: message.value,
            });
        }
        return deliveries;
      }),
    );

  const nextRequests = Effect.fn("BotLibraryService.nextRequests")(
    function* (environmentId: EnvironmentId, waitMs: number) {
      yield* requireEnabled;
      // Taken before the first look, so a request that lands in between still wakes this wait.
      const signal = yield* requestSignals.waiterFor(environmentId);
      const ready = yield* leaseRequests(environmentId);
      const wait = clampWait(waitMs);
      if (ready.length > 0 || wait === 0) return ready;
      yield* Deferred.await(signal).pipe(Effect.timeoutOption(Duration.millis(wait)));
      return yield* leaseRequests(environmentId);
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const ack = Effect.fn("BotLibraryService.ack")(
    function* (environmentId: EnvironmentId, input: BotLibraryAckRequest) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const row = (yield* sql<RequestRow>`SELECT * FROM fork_bots_library_requests
        WHERE id = ${input.messageId} AND target_env = ${environmentId}`)[0];
      if (row === undefined || row.state !== "pending") return;
      yield* sql`UPDATE fork_bots_library_requests SET state = 'delivered', delivered_at = ${isoAt(now)}
        WHERE id = ${row.id}`;
      const message = decodeMessage(row.message_json);
      if (input.refused !== null && Option.isSome(message) && message.value._tag === "run")
        yield* failRun(
          message.value.request.requestId,
          row.from_env,
          yield* labelOf(environmentId),
          input.refused,
          now,
        );
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure, SchemaError: storageFailure }),
  );

  const cancel = Effect.fn("BotLibraryService.cancel")(
    function* (environmentId: EnvironmentId, requestId: string) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const row = (yield* sql<RequestRow>`SELECT * FROM fork_bots_library_requests
        WHERE id = ${requestId} AND from_env = ${environmentId}`)[0];
      if (row === undefined) {
        // A submit still on its way after the requester gave up on it then finds this and stops.
        yield* sql`INSERT INTO fork_bots_library_requests (id, from_env, target_env, message_json, state, created_at)
          VALUES (${requestId}, ${environmentId}, '', '{}', 'cancelled', ${isoAt(now)})
          ON CONFLICT (id) DO NOTHING`;
        return true;
      }
      if (row.state === "cancelled" && row.leased_until === null) return true;
      if (row.state === "pending")
        yield* sql`UPDATE fork_bots_library_requests SET state = 'cancelled' WHERE id = ${row.id}`;
      if (row.state === "pending" && row.leased_until === null) {
        // Never handed out, so the target never hears of it.
        yield* insertResult(
          requestId,
          2,
          environmentId,
          {
            _tag: "terminal",
            label: yield* labelOf(row.target_env),
            status: "cancelled",
            startedAt: null,
            finishedAt: isoAt(now),
            result: null,
            resultTruncated: false,
            error: null,
            verdict: null,
            usage: null,
            modelSelection: null,
          },
          now,
        );
        return true;
      }
      // The target may have started the run without acking it yet, so it hears of the cancel and
      // reports the ending.
      const json = yield* encodeMessage({ _tag: "cancel", requestId });
      yield* sql`INSERT INTO fork_bots_library_requests (id, from_env, target_env, message_json, state, created_at)
        VALUES (${`${requestId}:cancel`}, ${environmentId}, ${row.target_env}, ${json}, 'pending', ${isoAt(now)})
        ON CONFLICT (id) DO NOTHING`;
      yield* requestSignals.wake(row.target_env);
      return false;
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure, SchemaError: storageFailure }),
  );

  const postResult = Effect.fn("BotLibraryService.postResult")(
    function* (environmentId: EnvironmentId, post: BotLibraryResultPost) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      const row = (yield* sql<RequestRow>`SELECT * FROM fork_bots_library_requests
        WHERE id = ${post.requestId} AND target_env = ${environmentId}`)[0];
      if (row === undefined)
        return yield* new BotLibraryError({
          reason: "not_found",
          message: "The Library has no such run for this computer.",
        });
      yield* insertResult(post.requestId, post.seq, row.from_env, post.update, now);
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure, SchemaError: storageFailure }),
  );

  const leaseResults = (environmentId: string) =>
    lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const rows =
          yield* sql<ResultRow>`SELECT request_id, seq, update_json FROM fork_bots_library_results
          WHERE to_env = ${environmentId} AND acked_at IS NULL
            AND (leased_until IS NULL OR leased_until <= ${isoAt(now)})
          ORDER BY created_at, seq LIMIT ${BATCH}`;
        const results: Array<BotLibraryResultPost> = [];
        for (const row of rows) {
          yield* sql`UPDATE fork_bots_library_results SET leased_until = ${isoAt(now + LEASE_MS)}
            WHERE request_id = ${row.request_id} AND seq = ${row.seq}`;
          const update = decodeUpdate(row.update_json);
          if (Option.isSome(update) && (row.seq === 1 || row.seq === 2))
            results.push({ requestId: row.request_id, seq: row.seq, update: update.value });
        }
        return results;
      }),
    );

  const nextResults = Effect.fn("BotLibraryService.nextResults")(
    function* (environmentId: EnvironmentId, waitMs: number) {
      yield* requireEnabled;
      const signal = yield* resultSignals.waiterFor(environmentId);
      const ready = yield* leaseResults(environmentId);
      const wait = clampWait(waitMs);
      if (ready.length > 0 || wait === 0) return ready;
      yield* Deferred.await(signal).pipe(Effect.timeoutOption(Duration.millis(wait)));
      return yield* leaseResults(environmentId);
    },
    Effect.catchTags({ SqlError: storageFailure }),
  );

  const ackResult = Effect.fn("BotLibraryService.ackResult")(
    function* (environmentId: EnvironmentId, input: BotLibraryResultAck) {
      yield* requireEnabled;
      const now = yield* Clock.currentTimeMillis;
      yield* sql`UPDATE fork_bots_library_results SET acked_at = ${isoAt(now)}
        WHERE request_id = ${input.requestId} AND seq = ${input.seq} AND to_env = ${environmentId}`;
    },
    lock.withPermit,
    Effect.catchTags({ SqlError: storageFailure }),
  );

  if (enabled) {
    const sweep = lock.withPermit(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const stale = yield* sql<RequestRow>`SELECT * FROM fork_bots_library_requests
          WHERE state = 'pending' AND created_at < ${isoAt(now - PICKUP_MS)}
            AND (leased_until IS NULL OR leased_until <= ${isoAt(now)})`;
        for (const row of stale) {
          yield* sql`UPDATE fork_bots_library_requests SET state = 'expired' WHERE id = ${row.id}`;
          // A target that picked the run up may be running it and still reports how it ends.
          if (row.leased_until !== null) continue;
          const message = decodeMessage(row.message_json);
          if (Option.isSome(message) && message.value._tag === "run") {
            const label = yield* labelOf(row.target_env);
            yield* failRun(row.id, row.from_env, label, `${label} did not pick up the run.`, now);
          }
        }
        const cutoff = isoAt(now - RETENTION_MS);
        yield* sql`DELETE FROM fork_bots_library_requests WHERE state <> 'pending' AND created_at < ${cutoff}`;
        yield* sql`DELETE FROM fork_bots_library_results WHERE acked_at IS NOT NULL AND acked_at < ${cutoff}`;
      }),
    );
    yield* forkParked(
      sweep.pipe(
        Effect.ignore({ log: "Warn", message: "Could not sweep the Library's bot runs" }),
        Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      ),
    );
  }

  return BotLibraryService.of({
    enabled,
    publish,
    unpublish,
    list,
    reportStatus,
    targets,
    submit,
    nextRequests,
    ack,
    cancel,
    postResult,
    nextResults,
    ackResult,
  });
});

export const layer = Layer.effect(BotLibraryService, make);
