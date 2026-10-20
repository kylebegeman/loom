import { observeVaultHealth } from "./health-observation.ts";
import { type ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultGitHubError,
  VaultGitHubCredential,
  VaultGitHubSave,
  VaultGitHubRun,
  VaultGitHubTerminalRun,
  type VaultGitHubTerminalResult,
  type VaultGitHubReadinessInput,
  type VaultGitHubReadiness,
  VaultGitHubTarget,
  vaultGitHubDestination,
  type VaultGitHubInfo,
  type VaultGitHubResult,
  type VaultGitHubTestResult,
  type VaultItemChange,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as GitHubTerminal from "./GitHubTerminal.ts";
import { githubTerminalArgs } from "./GitHubCommand.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
type Failure = VaultError | VaultGitHubError;
export class VaultGitHub extends Context.Service<
  VaultGitHub,
  {
    readonly info: (id: string) => Effect.Effect<VaultGitHubInfo, VaultError>;
    readonly list: (
      cursor: string | null,
    ) => Effect.Effect<
      { items: ReadonlyArray<VaultGitHubInfo>; nextCursor: string | null },
      VaultError
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
    ) => Effect.Effect<VaultGitHubInfo["item"], VaultError>;
    readonly terminal: (
      input: VaultGitHubTerminalRun,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitHubTerminalResult, Failure>;
    readonly readiness: (
      input: VaultGitHubReadinessInput,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGitHubReadiness, Failure>;
    readonly run: (
      input: VaultGitHubRun,
      threadId: ThreadId,
      guard?: Effect.Effect<void, VaultError>,
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
const isTerminal = Schema.is(VaultGitHubTerminalRun);
const isTarget = Schema.is(VaultGitHubTarget),
  isSave = Schema.is(Schema.toType(VaultGitHubSave)),
  isRun = Schema.is(VaultGitHubRun);
const fail = (reason: VaultError["reason"]) => new VaultError({ reason });
const make = Effect.gen(function* () {
  const core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    transport = yield* GitHubTransport.GitHubTransport,
    cli = yield* GitHubCli.GitHubCli,
    threads = yield* ThreadManagementService,
    projects = yield* ProjectStoreV2,
    terminal = yield* GitHubTerminal.GitHubTerminal;
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
  const runAuthorization = Effect.fnUntraced(function* (
    input: VaultGitHubTarget,
    threadId: ThreadId,
    guard: Effect.Effect<void, VaultError> = Effect.void,
  ) {
    const initial = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => fail("denied")));
    if (!initial?.activeRunId) return Effect.fail(fail("denied"));
    const authorize = Effect.gen(function* () {
      yield* guard;
      const thread = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => fail("denied")));
      if (
        !thread ||
        thread.activeRunId !== initial.activeRunId ||
        thread.projectId !== initial.projectId ||
        thread.worktreePath !== initial.worktreePath ||
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
    return authorize;
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
    test: Effect.fn("VaultGitHub.test")(
      function* (input, authorize) {
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
      },
      Effect.scoped,
      (effect, input) => observeVaultHealth(effect, input.id, input.expectedVersion),
    ),
    change: Effect.fn("VaultGitHub.change")(function* (input, actor, authorize) {
      yield* authorize;
      yield* load(input.id);
      return yield* core.change(input, actor, authorize);
    }),
    terminal: Effect.fn("VaultGitHub.terminal")(
      function* (input, threadId) {
        if (
          !isTerminal(input) ||
          !githubTerminalArgs(input.repository.toLowerCase(), input.command)
        )
          return yield* new VaultGitHubError({ reason: "invalid-command" });
        const authorize = yield* runAuthorization(input, threadId);
        yield* authorize;
        const thread = yield* threads
          .getThreadShell(threadId)
          .pipe(Effect.mapError(() => fail("denied")));
        if (!thread) return yield* fail("denied");
        const project = yield* projects
          .get(thread.projectId)
          .pipe(Effect.mapError(() => fail("denied")));
        if (Option.isNone(project) || project.value.deletedAt) return yield* fail("denied");
        const cwd = thread.worktreePath ?? project.value.workspaceRoot;
        if (!cwd.startsWith("/")) return yield* new VaultGitHubError({ reason: "unsupported" });
        return yield* permits.withPermits(1)(
          Effect.gen(function* () {
            yield* authorize;
            const record = yield* check(input),
              current = yield* session(record, input.repository);
            yield* authorize;
            const result = yield* terminal.execute({
              token: current.token,
              repository: input.repository.toLowerCase(),
              command: input.command,
              cwd,
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
      },
      Effect.scoped,
      (effect, input) => observeVaultHealth(effect, input.id, input.expectedVersion),
    ),
    readiness: Effect.fn("VaultGitHub.readiness")(function* (input, adminAuthorize) {
      let providerInstanceId: string | null = null;
      const authorize = input.threadId
        ? yield* runAuthorization(input, input.threadId, adminAuthorize)
        : adminAuthorize.pipe(
            Effect.andThen(() => check(input)),
            Effect.asVoid,
          );
      yield* adminAuthorize;
      const record = yield* check(input);
      if (input.threadId) {
        const thread = yield* threads
          .getThreadShell(input.threadId)
          .pipe(Effect.mapError(() => fail("denied")));
        providerInstanceId = thread?.providerInstanceId ?? null;
        const allowed = yield* authorize.pipe(
          Effect.as(true),
          Effect.catchTags({ VaultError: () => Effect.succeed(false) }),
        );
        if (!allowed) {
          yield* adminAuthorize;
          const now = yield* Clock.currentTimeMillis;
          return {
            account: record.info.account,
            repository: input.repository.toLowerCase(),
            expectedVersion: input.expectedVersion,
            checkedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
            expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 60000)),
            context: "loom-server" as const,
            providerInstanceId,
            grant: "denied" as const,
            checks: (["api", "gh", "git-https"] as const).map((kind) => ({
              kind,
              state: "skipped" as const,
              reason: "run-or-grant-denied",
            })),
          };
        }
      }
      return yield* permits.withPermits(1)(
        Effect.gen(function* () {
          yield* authorize;
          const acquired = yield* session(record, input.repository).pipe(
            Effect.map((current) => ({ current, reason: null })),
            Effect.catchTags({
              VaultGitHubError: (error) => Effect.succeed({ current: null, reason: error.reason }),
            }),
          );
          const checks: VaultGitHubReadiness["checks"][number][] = [];
          if (acquired.current === null) {
            checks.push(
              { kind: "api", state: "failed", reason: acquired.reason },
              { kind: "gh", state: "skipped", reason: acquired.reason },
              { kind: "git-https", state: "skipped", reason: acquired.reason },
            );
          } else {
            const current = acquired.current;
            const probe = (
              kind: VaultGitHubReadiness["checks"][number]["kind"],
              effect: Effect.Effect<void, VaultGitHubError>,
            ) =>
              effect.pipe(
                Effect.as({ kind, state: "ready" as const, reason: null }),
                Effect.catchTags({
                  VaultGitHubError: (error) =>
                    Effect.succeed({ kind, state: "failed" as const, reason: error.reason }),
                }),
              );
            yield* authorize;
            checks.push(
              yield* probe("api", transport.probe(current, input.repository.toLowerCase())),
            );
            for (const tool of ["gh", "git"] as const) {
              yield* authorize;
              checks.push(
                yield* probe(
                  tool === "gh" ? "gh" : "git-https",
                  terminal
                    .execute({
                      token: current.token,
                      repository: input.repository.toLowerCase(),
                      command:
                        tool === "gh"
                          ? { tool, argv: ["repo", "view", "--json", "nameWithOwner"] }
                          : {
                              tool,
                              argv: [
                                "ls-remote",
                                `https://github.com/${input.repository.toLowerCase()}.git`,
                              ],
                            },
                      cwd: null,
                      authorize: authorize.pipe(
                        Effect.mapError(() => new VaultGitHubError({ reason: "unauthorized" })),
                      ),
                    })
                    .pipe(
                      Effect.flatMap((output) =>
                        output.exitCode === 0
                          ? Effect.void
                          : Effect.fail(new VaultGitHubError({ reason: "failed" })),
                      ),
                    ),
                ),
              );
            }
            yield* authorize;
          }
          yield* authorize;
          const now = yield* Clock.currentTimeMillis;
          return {
            account: record.info.account,
            repository: input.repository.toLowerCase(),
            expectedVersion: input.expectedVersion,
            checkedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
            expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 60000)),
            context: "loom-server" as const,
            providerInstanceId,
            grant: input.threadId ? ("ready" as const) : ("unchecked" as const),
            checks,
          };
        }),
      );
    }, Effect.scoped),
    run: Effect.fn("VaultGitHub.run")(
      function* (input, threadId, guard = Effect.void) {
        if (!isRun(input)) return yield* fail("invalid-input");
        const authorize = yield* runAuthorization(input, threadId, guard);
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
      },
      Effect.scoped,
      (effect, input) => observeVaultHealth(effect, input.id, input.expectedVersion),
    ),
  });
});
export const layer = Layer.effect(VaultGitHub, make);
