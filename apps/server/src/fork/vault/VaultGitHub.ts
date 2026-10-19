import { type ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultGitHubError,
  VaultGitHubCredential,
  VaultGitHubSave,
  VaultGitHubRun,
  VaultGitHubTarget,
  vaultGitHubDestination,
  type VaultGitHubInfo,
  type VaultGitHubResult,
  type VaultGitHubTestResult,
  type VaultItemChange,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
type Failure = VaultError | VaultGitHubError;
export class VaultGitHub extends Context.Service<
  VaultGitHub,
  {
    readonly info: (id: string) => Effect.Effect<VaultGitHubInfo, Failure>;
    readonly list: (
      cursor: string | null,
    ) => Effect.Effect<
      { items: ReadonlyArray<VaultGitHubInfo>; nextCursor: string | null },
      Failure
    >;
    readonly save: (
      input: VaultGitHubSave,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGitHubInfo, Failure>;
    readonly test: (
      input: VaultGitHubTarget,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGitHubTestResult, Failure>;
    readonly change: (
      input: VaultItemChange,
      actor: string,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGitHubInfo["item"], Failure>;
    readonly run: (
      input: VaultGitHubRun,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitHubResult, Failure>;
  }
>()("t3/fork/vault/VaultGitHub") {}
const Stored = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  provider: Schema.Literal("github.com"),
  credential: VaultGitHubCredential,
  account: Schema.String,
  repositories: Schema.Array(VaultGitHubTarget.fields.repository).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
  ),
});
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Stored)),
  encode = Schema.encodeEffect(Schema.fromJsonString(Stored));
const isTarget = Schema.is(VaultGitHubTarget),
  isSave = Schema.is(Schema.toType(VaultGitHubSave)),
  isRun = Schema.is(VaultGitHubRun);
const fail = (reason: VaultError["reason"]) => new VaultError({ reason });
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    transport = yield* GitHubTransport.GitHubTransport,
    cli = yield* GitHubCli.GitHubCli,
    threads = yield* ThreadManagementService;
  const permits = yield* Semaphore.make(4);
  const load = Effect.fnUntraced(function* (id: string) {
    const item = yield* core.inspect(id);
    if (!item || item.kind !== "service-connection") return yield* fail("not-found");
    const value = yield* core.reveal({ id, expectedVersion: item.version });
    const stored = decode(Redacted.value(value.value));
    if (Option.isNone(stored)) return yield* fail("not-found");
    return {
      info: {
        item,
        account: stored.value.account,
        mechanism: stored.value.credential.type,
        repositories: stored.value.repositories,
      } satisfies VaultGitHubInfo,
      stored: stored.value,
    };
  });
  const check = Effect.fnUntraced(function* (input: VaultGitHubTarget) {
    if (!isTarget(input)) return yield* fail("invalid-input");
    const record = yield* load(input.id);
    if (record.info.item.state !== "active") return yield* fail("archived");
    if (record.info.item.version !== input.expectedVersion) return yield* fail("conflict");
    if (!record.stored.repositories.includes(input.repository.toLowerCase()))
      return yield* new VaultGitHubError({ reason: "repository-denied" });
    return record;
  });
  const acquireSession = (
    credential: typeof VaultGitHubCredential.Type,
    repositories: ReadonlyArray<string>,
  ) =>
    Effect.acquireRelease(transport.session(credential, repositories), (session) =>
      transport
        .release(session)
        .pipe(
          Effect.catch(() =>
            Effect.logWarning(
              "GitHub installation token cleanup failed; it may remain valid until expiry.",
            ),
          ),
        ),
    );
  const session = Effect.fnUntraced(function* (
    record: Effect.Success<ReturnType<typeof load>>,
    repository: string,
  ) {
    const session = yield* acquireSession(record.stored.credential, [repository.toLowerCase()]);
    if (session.account.toLowerCase() !== record.stored.account.toLowerCase())
      return yield* fail("conflict");
    return session;
  });
  return VaultGitHub.of({
    info: (id) => load(id).pipe(Effect.map((r) => r.info)),
    list: Effect.fn("VaultGitHub.list")(function* (cursor) {
      const page = yield* core.list({ cursor, includeArchived: true });
      const found = yield* Effect.forEach(
        page.items.filter((i) => i.kind === "service-connection" && i.state !== "deleted"),
        (i) =>
          load(i.id).pipe(
            Effect.map((r) => Option.some(r.info)),
            Effect.catchTags({
              VaultError: (error) =>
                error.reason === "not-found" ? Effect.succeedNone : Effect.fail(error),
            }),
          ),
      );
      return {
        items: found.flatMap((r) => (Option.isSome(r) ? [r.value] : [])),
        nextCursor: page.nextCursor,
      };
    }),
    save: Effect.fn("VaultGitHub.save")(function* (input, actor, authorize) {
      if (!isSave(input)) return yield* fail("invalid-input");
      yield* authorize;
      const existing = yield* core.inspect(input.id);
      if (existing) {
        if (existing.kind !== "service-connection") return yield* fail("conflict");
        yield* load(input.id);
      }
      const repositories = [...new Set(input.repositories.map((r) => r.toLowerCase()))].sort();
      const current = yield* acquireSession(input.credential, repositories);
      for (const repo of repositories) yield* transport.probe(current, repo);
      const value = yield* encode({
        schemaVersion: 1,
        provider: "github.com",
        credential: input.credential,
        account: current.account,
        repositories,
      }).pipe(Effect.mapError(() => fail("invalid-input")));
      yield* core.save(
        {
          id: input.id,
          operationId: input.operationId,
          expectedVersion: input.expectedVersion,
          label: input.label,
          kind: "service-connection",
          value: Redacted.make(value),
        },
        actor,
        authorize,
      );
      return (yield* load(input.id)).info;
    }, Effect.scoped),
    test: Effect.fn("VaultGitHub.test")(function* (input, authorize) {
      yield* authorize;
      const record = yield* check(input),
        current = yield* session(record, input.repository);
      yield* authorize;
      yield* check(input);
      yield* transport.probe(current, input.repository.toLowerCase());
      return {
        account: current.account,
        repository: input.repository.toLowerCase(),
        checkedAt: DateTime.formatIso(yield* DateTime.now),
        tokenExpiresAt: current.expiresAt,
        api: "ready" as const,
      };
    }, Effect.scoped),
    change: Effect.fn("VaultGitHub.change")(function* (input, actor, authorize) {
      yield* authorize;
      yield* load(input.id);
      return yield* core.change(input, actor, authorize);
    }),
    run: Effect.fn("VaultGitHub.run")(function* (input, threadId) {
      if (!isRun(input)) return yield* fail("invalid-input");
      const initial = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => fail("denied")));
      if (!initial?.activeRunId) return yield* fail("denied");
      const authorize = Effect.gen(function* () {
        const thread = yield* threads
          .getThreadShell(threadId)
          .pipe(Effect.mapError(() => fail("denied")));
        if (
          !thread ||
          thread.activeRunId !== initial.activeRunId ||
          thread.projectId !== initial.projectId ||
          thread.providerInstanceId !== initial.providerInstanceId ||
          thread.status !== "running" ||
          thread.runtimeMode !== "full-access" ||
          thread.interactionMode !== "default" ||
          thread.archivedAt ||
          thread.deletedAt
        )
          return yield* fail("denied");
        yield* access.require(threadId, input.id, "use", vaultGitHubDestination(input.repository));
        yield* check(input);
      });
      return yield* permits.withPermits(1)(
        Effect.gen(function* () {
          yield* authorize;
          const record = yield* check(input),
            current = yield* session(record, input.repository);
          yield* authorize;
          const result = yield* cli.run({
            token: current.token,
            repository: input.repository.toLowerCase(),
            operation: input.operation,
            authorize: authorize.pipe(
              Effect.mapError(() => new VaultGitHubError({ reason: "unauthorized" })),
            ),
          });
          return {
            account: current.account,
            repository: input.repository.toLowerCase(),
            ...result,
          };
        }),
      );
    }, Effect.scoped),
  });
});
export const layer = Layer.effect(VaultGitHub, make);
