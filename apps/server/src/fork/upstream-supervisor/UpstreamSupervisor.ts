import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import {
  UPSTREAM_WORKFLOW,
  UpstreamSupervisorConfig,
  UpstreamSupervisorConfigInput,
  UpstreamSupervisorDispatchInput,
  UpstreamSupervisorError,
  UpstreamSupervisorReceipt,
  type UpstreamSupervisorStatus,
  type UpstreamWorkflowSnapshot,
  VaultError,
} from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as ServerConfig from "../../config.ts";
import * as VaultGitHub from "../vault/VaultGitHub.ts";

export interface UpstreamSupervisorActor {
  readonly sessionId: string | null;
  readonly owner: boolean;
  readonly authorize: Effect.Effect<void, UpstreamSupervisorError>;
}
export class UpstreamSupervisor extends Context.Service<
  UpstreamSupervisor,
  {
    readonly configure: (
      input: UpstreamSupervisorConfigInput,
      actor: UpstreamSupervisorActor,
    ) => Effect.Effect<UpstreamSupervisorConfig, UpstreamSupervisorError>;
    readonly status: (
      projectId: string,
      actor: UpstreamSupervisorActor,
      runIds?: ReadonlyArray<number>,
    ) => Effect.Effect<UpstreamSupervisorStatus, UpstreamSupervisorError>;
    readonly dispatch: (
      input: UpstreamSupervisorDispatchInput,
      actor: UpstreamSupervisorActor,
    ) => Effect.Effect<UpstreamSupervisorReceipt, UpstreamSupervisorError>;
  }
>()("t3/fork/upstream-supervisor/UpstreamSupervisor") {}

const StoredReceipt = Schema.Struct({
  projectId: UpstreamSupervisorConfig.fields.projectId,
  repository: UpstreamSupervisorConfig.fields.connection.fields.repository,
  receipt: UpstreamSupervisorReceipt,
});
const State = Schema.Struct({
  version: Schema.Literal(1),
  config: Schema.NullOr(UpstreamSupervisorConfig),
  configuredBy: Schema.optionalKey(Schema.NullOr(Schema.String)),
  receipts: Schema.Array(StoredReceipt).check(Schema.isMaxLength(1000)),
});
type State = typeof State.Type;
const stateJson = Schema.fromJsonString(State);
const isConfigInput = Schema.is(UpstreamSupervisorConfigInput);
const isDispatchInput = Schema.is(UpstreamSupervisorDispatchInput);
const failure = (reason: UpstreamSupervisorError["reason"]) =>
  new UpstreamSupervisorError({ reason });
const sameGrant = (a: UpstreamSupervisorConfig, b: UpstreamSupervisorConfig) =>
  a.updatedAt === b.updatedAt &&
  a.projectId === b.projectId &&
  a.clientSessionId === b.clientSessionId &&
  a.connection.id === b.connection.id &&
  a.connection.expectedVersion === b.connection.expectedVersion &&
  a.connection.repository === b.connection.repository &&
  a.enabled === b.enabled;
const unresolved = (r: UpstreamSupervisorReceipt) =>
  r.status === "dispatching" ||
  r.status === "unknown" ||
  (r.status === "accepted" && (r.run === null || r.run.status !== "completed"));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const github = yield* VaultGitHub.VaultGitHub;
  const sessions = yield* SessionStore.SessionStore;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const statePath = path.join(config.stateDir, "fork", "upstream-supervisor", "state.json");
  const read = Effect.fn("UpstreamSupervisor.read")(
    function* () {
      if (!(yield* fs.exists(statePath)))
        return { version: 1, config: null, receipts: [] } satisfies State;
      const stat = yield* fs.stat(statePath);
      if (stat.size > 2 * 1024 * 1024) return yield* failure("storage");
      return yield* fs
        .readFileString(statePath)
        .pipe(Effect.flatMap(Schema.decodeEffect(stateJson)));
    },
    Effect.mapError(() => failure("storage")),
  );
  const write = Effect.fn("UpstreamSupervisor.write")(
    function* (state: State) {
      const contents = yield* Schema.encodeEffect(stateJson)(state);
      const directory = path.dirname(statePath);
      yield* fs.makeDirectory(directory, { recursive: true });
      const temporary = path.join(directory, `${yield* crypto.randomUUIDv4()}.pending`);
      yield* Effect.gen(function* () {
        yield* fs.writeFileString(temporary, `${contents}\n`, { mode: 0o600, flag: "wx" });
        yield* Effect.scoped(fs.open(temporary).pipe(Effect.flatMap((file) => file.sync)));
        yield* fs.rename(temporary, statePath);
        yield* Effect.scoped(fs.open(directory).pipe(Effect.flatMap((file) => file.sync)));
      }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
    },
    Effect.mapError(() => failure("storage")),
  );
  const activeSession = Effect.fn("UpstreamSupervisor.activeSession")(function* (
    sessionId: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const active = yield* sessions.listActive().pipe(Effect.mapError(() => failure("denied")));
    const session = active.find((item) => item.sessionId === sessionId);
    if (
      !session ||
      DateTime.toEpochMillis(session.expiresAt) <= now ||
      !(session.permissions ?? session.scopes).includes(AuthOrchestrationOperateScope)
    )
      return yield* failure("denied");
  });
  const grant = Effect.fn("UpstreamSupervisor.grant")(function* (
    projectId: string,
    actor: UpstreamSupervisorActor,
    expected?: UpstreamSupervisorConfig,
    operating = false,
  ) {
    yield* actor.authorize;
    const state = yield* read();
    if (state.config === null) return yield* failure("not_configured");
    const current = state.config;
    if (current.projectId !== projectId || (expected && !sameGrant(current, expected)))
      return yield* failure("denied");
    if (!actor.owner) {
      if (actor.sessionId !== current.clientSessionId) return yield* failure("denied");
      yield* activeSession(current.clientSessionId);
    }
    if (operating && !current.enabled) return yield* failure("disabled");
    return current;
  });
  const brokerGuard = (
    current: UpstreamSupervisorConfig,
    actor: UpstreamSupervisorActor,
    operating: boolean,
  ) =>
    grant(current.projectId, actor, current, operating).pipe(
      Effect.asVoid,
      Effect.mapError(() => new VaultError({ reason: "denied" })),
    );
  const reconcile = Effect.fn("UpstreamSupervisor.reconcile")(function* (
    current: UpstreamSupervisorConfig,
    snapshot: UpstreamWorkflowSnapshot,
  ) {
    return yield* Effect.gen(function* () {
      const state = yield* read();
      if (!state.config || !sameGrant(state.config, current)) return yield* failure("denied");
      let changed = false;
      const receipts = state.receipts.map((entry) => {
        if (
          entry.projectId !== current.projectId ||
          entry.repository !== current.connection.repository
        )
          return entry;
        const receipt = entry.receipt;
        const matches = snapshot.runs.filter((run) => run.title.includes(`[${receipt.id}]`));
        if (matches.length > 1) return entry;
        const run = matches[0] ?? receipt.run;
        const status = run
          ? ("accepted" as const)
          : receipt.status === "dispatching"
            ? ("unknown" as const)
            : receipt.status;
        if (
          status === receipt.status &&
          run?.id === receipt.run?.id &&
          run?.attempt === receipt.run?.attempt &&
          run?.status === receipt.run?.status &&
          run?.conclusion === receipt.run?.conclusion &&
          run?.headSha === receipt.run?.headSha
        )
          return entry;
        changed = true;
        return { ...entry, receipt: { ...receipt, status, run } };
      });
      if (changed) yield* write({ ...state, receipts });
      return receipts
        .filter(
          (entry) =>
            entry.projectId === current.projectId &&
            entry.repository === current.connection.repository,
        )
        .map((entry) => entry.receipt);
    }).pipe(lock.withPermit);
  });
  const configure = Effect.fn("UpstreamSupervisor.configure")(function* (
    input: UpstreamSupervisorConfigInput,
    actor: UpstreamSupervisorActor,
  ) {
    if (!isConfigInput(input)) return yield* failure("invalid");
    yield* actor.authorize;
    if (!actor.owner) return yield* failure("denied");
    if (input.enabled) {
      yield* activeSession(input.clientSessionId);
      const info = yield* github
        .info(input.connection.id)
        .pipe(Effect.mapError(() => failure("denied")));
      if (
        info.item.version !== input.connection.expectedVersion ||
        info.item.state !== "active" ||
        !info.repositories.includes(input.connection.repository.toLowerCase())
      )
        return yield* failure("denied");
    }
    return yield* Effect.gen(function* () {
      yield* actor.authorize;
      const state = yield* read();
      if (
        state.config &&
        state.receipts.some((entry) => unresolved(entry.receipt)) &&
        (state.config.projectId !== input.projectId ||
          state.config.connection.repository !== input.connection.repository.toLowerCase())
      )
        return yield* failure("conflict");
      const next = {
        ...input,
        connection: { ...input.connection, repository: input.connection.repository.toLowerCase() },
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      };
      yield* write({ ...state, config: next, configuredBy: actor.sessionId });
      return next;
    }).pipe(lock.withPermit);
  });
  const status = Effect.fn("UpstreamSupervisor.status")(function* (
    projectId: string,
    actor: UpstreamSupervisorActor,
    runIds: ReadonlyArray<number> = [],
  ): Effect.fn.Return<UpstreamSupervisorStatus, UpstreamSupervisorError> {
    yield* actor.authorize;
    const saved = yield* read();
    if (saved.config === null && actor.owner)
      return { config: null, workflow: UPSTREAM_WORKFLOW, mainSha: null, runs: [], receipts: [] };
    const selectedProject = actor.owner && saved.config ? saved.config.projectId : projectId;
    const current = yield* grant(selectedProject, actor);
    const result = yield* github
      .upstreamWorkflow(
        current.connection,
        {
          action: "status",
          runIds: [
            ...new Set([
              ...runIds,
              ...saved.receipts
                .filter(
                  (entry) =>
                    entry.projectId === current.projectId &&
                    entry.repository === current.connection.repository &&
                    entry.receipt.run &&
                    entry.receipt.run.status !== "completed",
                )
                .map((entry) => entry.receipt.run!.id),
            ]),
          ].slice(0, 30),
        },
        brokerGuard(current, actor, false),
      )
      .pipe(Effect.result);
    if (result._tag === "Failure") {
      yield* grant(selectedProject, actor, current);
      const retained = (yield* read()).receipts.filter(
        (entry) =>
          entry.projectId === selectedProject && entry.repository === current.connection.repository,
      );
      return {
        config: current,
        workflow: UPSTREAM_WORKFLOW,
        unavailable: true,
        mainSha: null,
        runs: [],
        receipts: retained.slice(-30).map((entry) => entry.receipt),
      };
    }
    const receipts = yield* reconcile(current, result.success.snapshot);
    return {
      config: current,
      workflow: UPSTREAM_WORKFLOW,
      ...result.success.snapshot,
      receipts: receipts.slice(-30),
    };
  });
  const dispatch = Effect.fn("UpstreamSupervisor.dispatch")(function* (
    input: UpstreamSupervisorDispatchInput,
    actor: UpstreamSupervisorActor,
  ) {
    if (!isDispatchInput(input)) return yield* failure("invalid");
    const current = yield* grant(input.projectId, actor, undefined, true);
    const previous = (yield* read()).receipts.find(
      (entry) =>
        entry.projectId === input.projectId &&
        entry.repository === current.connection.repository &&
        entry.receipt.clientRequestId === input.clientRequestId,
    );
    if (previous) {
      if (
        previous.receipt.targetTag !== input.targetTag ||
        previous.receipt.expectedMainSha !== input.expectedMainSha
      )
        return yield* failure("conflict");
      return previous.receipt.status === "dispatching"
        ? { ...previous.receipt, status: "unknown" as const }
        : previous.receipt;
    }
    const observed = yield* status(input.projectId, actor);
    if (observed.unavailable) return yield* failure("unavailable");
    if (observed.mainSha !== input.expectedMainSha) return yield* failure("stale");
    if (observed.runs.some((run) => run.status !== "completed")) return yield* failure("active");
    const hash = yield* crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          [input.projectId, current.connection.repository, input.clientRequestId]
            .map((part) => `${part.length}:${part}`)
            .join(""),
        ),
      )
      .pipe(Effect.mapError(() => failure("unavailable")));
    const id = Buffer.from(hash).toString("hex");
    const receipt: UpstreamSupervisorReceipt = {
      id,
      clientRequestId: input.clientRequestId,
      targetTag: input.targetTag,
      expectedMainSha: input.expectedMainSha,
      status: "dispatching",
      createdAt: DateTime.formatIso(yield* DateTime.now),
      httpStatus: null,
      run: null,
    };
    const admitted = yield* Effect.gen(function* () {
      yield* grant(input.projectId, actor, current, true);
      const state = yield* read();
      const same = state.receipts.find(
        (entry) =>
          entry.projectId === input.projectId &&
          entry.repository === current.connection.repository &&
          entry.receipt.clientRequestId === input.clientRequestId,
      );
      if (same) {
        if (
          same.receipt.targetTag !== input.targetTag ||
          same.receipt.expectedMainSha !== input.expectedMainSha
        )
          return yield* failure("conflict");
        return false;
      }
      if (state.receipts.some((entry) => unresolved(entry.receipt)))
        return yield* failure("active");
      if (
        state.receipts.length >= 1000 ||
        state.receipts.some(
          (entry) =>
            entry.projectId === input.projectId &&
            entry.repository === current.connection.repository &&
            entry.receipt.targetTag === input.targetTag &&
            entry.receipt.expectedMainSha === input.expectedMainSha,
        )
      )
        return yield* failure("conflict");
      yield* write({
        ...state,
        receipts: [
          ...state.receipts,
          {
            projectId: input.projectId,
            repository: current.connection.repository,
            receipt,
          },
        ],
      });
      return true;
    }).pipe(lock.withPermit);
    if (!admitted) {
      const saved = (yield* read()).receipts.find((entry) => entry.receipt.id === id);
      if (!saved) return yield* failure("storage");
      return saved.receipt.status === "dispatching"
        ? { ...saved.receipt, status: "unknown" as const }
        : saved.receipt;
    }
    const result = yield* github
      .upstreamWorkflow(
        current.connection,
        {
          action: "dispatch",
          targetTag: input.targetTag,
          expectedMainSha: input.expectedMainSha,
          requestId: id,
        },
        brokerGuard(current, actor, true),
      )
      .pipe(Effect.result);
    const next: UpstreamSupervisorReceipt =
      result._tag === "Failure"
        ? { ...receipt, status: result.failure._tag === "VaultError" ? "refused" : "unknown" }
        : {
            ...receipt,
            status: result.success.httpStatus === 204 ? "accepted" : "refused",
            httpStatus: result.success.httpStatus,
          };
    yield* Effect.gen(function* () {
      const state = yield* read();
      yield* write({
        ...state,
        receipts: state.receipts.map((entry) =>
          entry.receipt.id === id
            ? {
                ...entry,
                receipt: entry.receipt.run
                  ? { ...next, status: "accepted" as const, run: entry.receipt.run }
                  : next,
              }
            : entry,
        ),
      });
    }).pipe(lock.withPermit);
    return next;
  });
  return UpstreamSupervisor.of({ configure, status, dispatch });
});
export const layer = Layer.effect(UpstreamSupervisor, make);
