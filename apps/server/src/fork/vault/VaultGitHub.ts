import * as GitHubRepositoryTransport from "./GitHubRepositoryTransport.ts";
import type * as ProcessRunner from "../../processRunner.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { isVaultRunRunning } from "./active-run.ts";
import { admissionStamp } from "./admission-stamp.ts";
import { observeVaultHealth } from "./health-observation.ts";
import { type ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VaultGitHubError,
  VAULT_GITHUB_REPOSITORY_LIMIT,
  VAULT_GITHUB_OWNER_REPOSITORY_LIMIT,
  VaultGitHubCredential,
  VaultGitHubSave,
  VaultGitHubRun,
  VaultGitHubRunInput,
  VaultGitHubTerminalRunInput,
  VaultConnectionError,
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
  UPSTREAM_WORKFLOW,
  UPSTREAM_REF,
  UpstreamCommitSha,
  UpstreamTargetTag,
  UpstreamRequestId,
  type UpstreamWorkflowSnapshot,
  type UpstreamWorkflowRun,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as ByteSize from "effect/ByteSize";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import * as GitHubTerminal from "./GitHubTerminal.ts";
import { githubTerminalArgs } from "./GitHubCommand.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultConnections from "./VaultConnections.ts";
import * as AccountVaultClient from "./AccountVaultClient.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as GitHubTransport from "./GitHubTransport.ts";
import * as GitHubCli from "./GitHubCli.ts";
type Failure = VaultError | VaultGitHubError;
type ConnectionFailure = Failure | VaultConnectionError;
export class VaultGitHub extends Context.Service<
  VaultGitHub,
  {
    readonly terminalForAccount: (
      input: VaultGitHubTerminalRun,
      account: {
        readonly lease: Parameters<
          VaultAccess.VaultAccess["Service"]["authorizeAccount"]
        >[0]["lease"];
        readonly authorize: Effect.Effect<void, VaultError>;
      },
    ) => Effect.Effect<
      { account: string; token: Redacted.Redacted<string> },
      ConnectionFailure,
      Scope.Scope
    >;
    readonly runForAccount: (
      input: VaultGitHubRun,
      account: {
        readonly lease: Parameters<
          VaultAccess.VaultAccess["Service"]["authorizeAccount"]
        >[0]["lease"];
        readonly authorize: Effect.Effect<void, VaultError>;
      },
    ) => Effect.Effect<VaultGitHubResult, ConnectionFailure>;
    readonly repositoryOperation: (
      input: VaultGitHubTarget,
      operation: GitHubRepositoryTransport.RepositoryOperation,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<ProcessRunner.ProcessRunOutput, Failure>;
    readonly upstreamWorkflow: (
      input: VaultGitHubTarget,
      request:
        | { readonly action: "status"; readonly runIds?: ReadonlyArray<number> }
        | {
            readonly action: "dispatch";
            readonly targetTag: string;
            readonly expectedMainSha: string;
            readonly requestId: string;
          }
        | {
            readonly action: "retry-failed";
            readonly runId: number;
            readonly expectedAttempt: number;
            readonly expectedMainSha: string;
          },
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<
      { readonly snapshot: UpstreamWorkflowSnapshot; readonly httpStatus: number | null },
      Failure
    >;
    readonly admission: (
      input: VaultGitHubRun,
      threadId: ThreadId,
    ) => Effect.Effect<string, Failure>;
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
      input: VaultGitHubTerminalRunInput,
      threadId: ThreadId,
    ) => Effect.Effect<VaultGitHubTerminalResult, ConnectionFailure>;
    readonly readiness: (
      input: VaultGitHubReadinessInput,
      authorize: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGitHubReadiness, Failure>;
    readonly run: (
      input: VaultGitHubRunInput,
      threadId: ThreadId,
      guard?: Effect.Effect<void, VaultError>,
    ) => Effect.Effect<VaultGitHubResult, ConnectionFailure>;
  }
>()("t3/fork/vault/VaultGitHub") {}
export const Stored = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  provider: Schema.Literal("github.com"),
  credential: VaultGitHubCredential,
  account: Schema.String,
  repositories: Schema.Array(VaultGitHubTarget.fields.repository).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(VAULT_GITHUB_OWNER_REPOSITORY_LIMIT),
  ),
});
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Stored)),
  encode = Schema.encodeEffect(Schema.fromJsonString(Stored));
const isTerminal = Schema.is(VaultGitHubTerminalRun),
  isTerminalInput = Schema.is(VaultGitHubTerminalRunInput),
  isRunInput = Schema.is(VaultGitHubRunInput);
const isTarget = Schema.is(VaultGitHubTarget),
  isSave = Schema.is(Schema.toType(VaultGitHubSave)),
  isRun = Schema.is(VaultGitHubRun);
const fail = (reason: VaultError["reason"]) => new VaultError({ reason });
const UpstreamGitHubRef = Schema.Struct({ object: Schema.Struct({ sha: UpstreamCommitSha }) });
const UpstreamGitHubTag = Schema.Struct({
  ref: Schema.String,
  object: Schema.Struct({ sha: UpstreamCommitSha }),
});
const UpstreamGitHubRun = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  run_attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: Schema.String.check(Schema.isMaxLength(80)),
  conclusion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))),
  head_sha: UpstreamCommitSha,
  html_url: Schema.String.check(Schema.isMaxLength(2048)),
  display_title: Schema.String.check(Schema.isMaxLength(300)),
  created_at: Schema.String.check(Schema.isMaxLength(80)),
});
const UpstreamGitHubRuns = Schema.Struct({
  workflow_runs: Schema.Array(UpstreamGitHubRun).check(Schema.isMaxLength(30)),
});
const UpstreamGitHubKnownRun = Schema.Struct({
  ...UpstreamGitHubRun.fields,
  workflow_id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  head_branch: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(300))),
});
const UpstreamGitHubWorkflow = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  path: Schema.String.check(Schema.isMaxLength(300)),
});
const decodeUpstreamRef = Schema.decodeUnknownEffect(UpstreamGitHubRef);
const decodeUpstreamTag = Schema.decodeUnknownEffect(UpstreamGitHubTag);
const decodeUpstreamRuns = Schema.decodeUnknownEffect(UpstreamGitHubRuns);
const decodeUpstreamKnownRun = Schema.decodeUnknownEffect(UpstreamGitHubKnownRun);
const decodeUpstreamWorkflow = Schema.decodeUnknownEffect(UpstreamGitHubWorkflow);
const isUpstreamTag = Schema.is(UpstreamTargetTag);
const isUpstreamSha = Schema.is(UpstreamCommitSha);
const isUpstreamRequestId = Schema.is(UpstreamRequestId);
const make = Effect.gen(function* () {
  const accountClient = yield* AccountVaultClient.AccountVaultClient;
  const core = yield* VaultCore.VaultCore,
    access = yield* VaultAccess.VaultAccess,
    transport = yield* GitHubTransport.GitHubTransport,
    cli = yield* GitHubCli.GitHubCli,
    threads = yield* ThreadManagementService,
    projects = yield* ProjectStoreV2,
    terminal = yield* GitHubTerminal.GitHubTerminal;
  const repositoryTransport = yield* Effect.serviceOption(
    GitHubRepositoryTransport.GitHubRepositoryTransport,
  );
  const connections = yield* VaultConnections.VaultConnections;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const health = yield* Effect.serviceOption(VaultHealth.VaultHealth);
  const http = yield* Effect.serviceOption(HttpClient.HttpClient);
  const observeExpiry = Effect.fn("VaultGitHub.observeExpiry")(function* (
    info: VaultGitHubInfo,
    current: GitHubTransport.GitHubSession,
  ) {
    if (info.mechanism !== "token" || !current.expiresAt || Option.isNone(health)) return;
    const expiresAt = Date.parse(current.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    yield* health.value
      .observeExpiry(info.item.id, info.item.version, expiresAt)
      .pipe(Effect.ignore);
  });
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
      return yield* new VaultGitHubError({
        reason: "repository-denied",
        repair: {
          id: input.id,
          repository: input.repository,
          settingsPath: `/settings/loom?machine=${encodeURIComponent(environmentId)}&section=vault-github#loom-vault-github?connection=${input.id}&repository=${encodeURIComponent(input.repository)}`,
        },
      });
    return record;
  });
  const acquireSession = (credential: VaultGitHubCredential, repositories: ReadonlyArray<string>) =>
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
    yield* observeExpiry(record.info, session);
    return session;
  });
  // Source execution must stay attached to the run and working copy that requested credentials.
  const workloadAuthorization = Effect.fnUntraced(function* (threadId: ThreadId) {
    const initial = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => fail("denied")));
    if (!initial?.activeRunId) return yield* fail("denied");
    return Effect.gen(function* () {
      const thread = yield* threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => fail("denied")));
      if (
        !thread ||
        thread.activeRunId !== initial.activeRunId ||
        thread.projectId !== initial.projectId ||
        thread.worktreePath !== initial.worktreePath ||
        thread.providerInstanceId !== initial.providerInstanceId ||
        !(yield* isVaultRunRunning(threads, thread)) ||
        thread.runtimeMode !== "full-access" ||
        thread.interactionMode !== "default" ||
        thread.archivedAt ||
        thread.deletedAt
      )
        return yield* fail("denied");
    });
  });
  const runAuthorization = Effect.fnUntraced(function* (
    input: VaultGitHubTarget,
    threadId: ThreadId,
    guard: Effect.Effect<void, VaultError | VaultConnectionError> = Effect.void,
    authorization: "audit" | "observe" = "audit",
  ) {
    const workload = yield* workloadAuthorization(threadId);
    const authorize = Effect.gen(function* () {
      yield* guard;
      yield* workload;
      if (authorization === "audit") {
        yield* access.require(threadId, input.id, "use", vaultGitHubDestination(input.repository));
      } else {
        const explanation = yield* access.explain({
          threadId,
          itemId: input.id,
          action: "use",
          destination: vaultGitHubDestination(input.repository),
        });
        if (!explanation.decision.allowed) return yield* fail("denied");
      }
      yield* check(input);
    });
    return authorize;
  });
  // This broker uses the controller's explicit standing authority; generic Vault execution still requires an active full-access run.
  const upstreamWorkflow: VaultGitHub["Service"]["upstreamWorkflow"] = Effect.fn(
    "VaultGitHub.upstreamWorkflow",
  )(
    function* (input, operation, authorize) {
      yield* authorize;
      if (!isTarget(input) || !["status", "dispatch", "retry-failed"].includes(operation.action))
        return yield* fail("invalid-input");
      if (
        operation.action === "dispatch" &&
        (!isUpstreamTag(operation.targetTag) ||
          !isUpstreamSha(operation.expectedMainSha) ||
          !isUpstreamRequestId(operation.requestId))
      )
        return yield* fail("invalid-input");
      if (
        operation.action === "retry-failed" &&
        (!Number.isSafeInteger(operation.runId) ||
          operation.runId < 1 ||
          operation.expectedAttempt !== 1 ||
          !isUpstreamSha(operation.expectedMainSha))
      )
        return yield* fail("invalid-input");
      if (
        operation.action === "status" &&
        operation.runIds !== undefined &&
        (!Array.isArray(operation.runIds) ||
          operation.runIds.length > 30 ||
          operation.runIds.some((id) => !Number.isSafeInteger(id) || id < 1))
      )
        return yield* fail("invalid-input");
      if (Option.isNone(http)) return yield* new VaultGitHubError({ reason: "unavailable" });
      const client = http.value;
      const repository = input.repository.toLowerCase();
      const record = yield* check(input);
      yield* authorize;
      const current = yield* session(record, repository);
      const request = Effect.fn("VaultGitHub.upstreamRequest")(function* (
        path: string,
        body?:
          | {
              ref: string;
              inputs: { target: string; supervisor_request_id: string; expected_main_sha: string };
            }
          | Record<string, never>,
      ) {
        yield* authorize;
        yield* check(input);
        let req = (body ? HttpClientRequest.post : HttpClientRequest.get)(
          `https://api.github.com${path}`,
        ).pipe(
          HttpClientRequest.bearerToken(current.token),
          HttpClientRequest.setHeaders({
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Loom-Upstream-Supervisor",
          }),
        );
        if (body)
          req = yield* HttpClientRequest.bodyJson(req, body).pipe(
            Effect.mapError(() => new VaultGitHubError({ reason: "invalid-response" })),
          );
        yield* authorize;
        const response = yield* client.execute(req).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.timeout("15 seconds"),
          Effect.mapError(() => new VaultGitHubError({ reason: "unavailable" })),
        );
        if (body) {
          if (
            response.status === 201 ||
            response.status === 204 ||
            (response.status >= 400 && response.status < 500)
          )
            return { status: response.status, body: null };
          return yield* new VaultGitHubError({ reason: "unavailable" });
        }
        if (response.status === 401) return yield* new VaultGitHubError({ reason: "unauthorized" });
        if (response.status === 403 || response.status === 404)
          return yield* new VaultGitHubError({ reason: "repository-denied" });
        if (response.status !== 200) return yield* new VaultGitHubError({ reason: "unavailable" });
        const responseBody = yield* response.json.pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
          Effect.timeout("15 seconds"),
          Effect.mapError(() => new VaultGitHubError({ reason: "invalid-response" })),
        );
        return { status: response.status, body: responseBody };
      });
      const ref = yield* request(`/repos/${repository}/git/ref/heads/${UPSTREAM_REF}`).pipe(
        Effect.flatMap((response) => decodeUpstreamRef(response.body)),
        Effect.mapError((error) =>
          error._tag === "SchemaError"
            ? new VaultGitHubError({ reason: "invalid-response" })
            : error,
        ),
      );
      const runs = yield* request(
        `/repos/${repository}/actions/workflows/${UPSTREAM_WORKFLOW}/runs?per_page=30`,
      ).pipe(
        Effect.flatMap((response) => decodeUpstreamRuns(response.body)),
        Effect.mapError((error) =>
          error._tag === "SchemaError"
            ? new VaultGitHubError({ reason: "invalid-response" })
            : error,
        ),
      );
      const normalize = Effect.fn("VaultGitHub.normalizeUpstreamRun")(function* (
        run: typeof UpstreamGitHubRun.Type,
      ) {
        if (run.html_url !== `https://github.com/${repository}/actions/runs/${run.id}`)
          return yield* new VaultGitHubError({ reason: "invalid-response" });
        return {
          id: run.id,
          attempt: run.run_attempt,
          status: run.status,
          conclusion: run.conclusion,
          headSha: run.head_sha,
          url: run.html_url,
          title: run.display_title,
          createdAt: run.created_at,
        } satisfies UpstreamWorkflowRun;
      });
      const normalized = yield* Effect.forEach(runs.workflow_runs, normalize);
      const known: Array<UpstreamWorkflowRun> = [];
      const knownRunIds =
        operation.action === "status"
          ? operation.runIds
          : operation.action === "retry-failed"
            ? [operation.runId]
            : undefined;
      let retryRun: typeof UpstreamGitHubKnownRun.Type | undefined;
      if (knownRunIds?.length) {
        const workflow = yield* request(
          `/repos/${repository}/actions/workflows/${UPSTREAM_WORKFLOW}`,
        ).pipe(
          Effect.flatMap((response) => decodeUpstreamWorkflow(response.body)),
          Effect.mapError((error) =>
            error._tag === "SchemaError"
              ? new VaultGitHubError({ reason: "invalid-response" })
              : error,
          ),
        );
        if (workflow.path !== `.github/workflows/${UPSTREAM_WORKFLOW}`)
          return yield* new VaultGitHubError({ reason: "invalid-response" });
        for (const id of new Set(knownRunIds)) {
          const run = yield* request(`/repos/${repository}/actions/runs/${id}`).pipe(
            Effect.flatMap((response) => decodeUpstreamKnownRun(response.body)),
            Effect.mapError((error) =>
              error._tag === "SchemaError"
                ? new VaultGitHubError({ reason: "invalid-response" })
                : error,
            ),
          );
          if (run.id !== id || run.workflow_id !== workflow.id)
            return yield* new VaultGitHubError({ reason: "invalid-response" });
          if (operation.action === "retry-failed") retryRun = run;
          known.push(yield* normalize(run));
        }
      }
      const knownIds = new Set(known.map((run) => run.id));
      const snapshot: UpstreamWorkflowSnapshot = {
        mainSha: ref.object.sha,
        runs: [...known, ...normalized.filter((run) => !knownIds.has(run.id))].slice(0, 30),
      };
      if (operation.action === "status") return { snapshot, httpStatus: null };
      if (
        snapshot.mainSha !== operation.expectedMainSha ||
        snapshot.runs.some((run) => run.status !== "completed")
      )
        return yield* fail("conflict");
      for (const status of ["in_progress", "queued", "requested", "waiting", "pending"]) {
        const active = yield* request(
          `/repos/${repository}/actions/workflows/${UPSTREAM_WORKFLOW}/runs?status=${status}&per_page=1`,
        ).pipe(
          Effect.flatMap((response) => decodeUpstreamRuns(response.body)),
          Effect.mapError((error) =>
            error._tag === "SchemaError"
              ? new VaultGitHubError({ reason: "invalid-response" })
              : error,
          ),
        );
        if (active.workflow_runs.length > 0) return yield* fail("conflict");
      }
      if (operation.action === "retry-failed") {
        const validRun = (run: typeof UpstreamGitHubKnownRun.Type) =>
          run.id === operation.runId &&
          run.head_branch === UPSTREAM_REF &&
          run.status === "completed" &&
          run.conclusion === "failure" &&
          run.run_attempt === operation.expectedAttempt &&
          run.head_sha === operation.expectedMainSha;
        if (!retryRun || !validRun(retryRun)) return yield* fail("conflict");
        const latestRef = yield* request(`/repos/${repository}/git/ref/heads/${UPSTREAM_REF}`).pipe(
          Effect.flatMap((response) => decodeUpstreamRef(response.body)),
          Effect.mapError((error) =>
            error._tag === "SchemaError"
              ? new VaultGitHubError({ reason: "invalid-response" })
              : error,
          ),
        );
        const latestRun = yield* request(
          `/repos/${repository}/actions/runs/${operation.runId}`,
        ).pipe(
          Effect.flatMap((response) => decodeUpstreamKnownRun(response.body)),
          Effect.mapError((error) =>
            error._tag === "SchemaError"
              ? new VaultGitHubError({ reason: "invalid-response" })
              : error,
          ),
        );
        if (
          latestRef.object.sha !== operation.expectedMainSha ||
          latestRun.workflow_id !== retryRun.workflow_id ||
          !validRun(latestRun)
        )
          return yield* fail("conflict");
        yield* normalize(latestRun);
        const response = yield* request(
          `/repos/${repository}/actions/runs/${operation.runId}/rerun-failed-jobs`,
          {},
        );
        return { snapshot, httpStatus: response.status };
      }
      const target = yield* request(
        `/repos/pingdotgg/t3code/git/ref/tags/${encodeURIComponent(operation.targetTag)}`,
      ).pipe(
        Effect.flatMap((response) => decodeUpstreamTag(response.body)),
        Effect.mapError((error) =>
          error._tag === "SchemaError"
            ? new VaultGitHubError({ reason: "invalid-response" })
            : error,
        ),
      );
      if (target.ref !== `refs/tags/${operation.targetTag}`) return yield* fail("invalid-input");
      const response = yield* request(
        `/repos/${repository}/actions/workflows/${UPSTREAM_WORKFLOW}/dispatches`,
        {
          ref: UPSTREAM_REF,
          inputs: {
            target: operation.targetTag,
            supervisor_request_id: operation.requestId,
            expected_main_sha: operation.expectedMainSha,
          },
        },
      );
      return { snapshot, httpStatus: response.status };
    },
    Effect.scoped,
    permits.withPermits(1),
  );
  const runAuthorized = Effect.fn("VaultGitHub.runAuthorized")(function* (
    input: VaultGitHubRun,
    authorize: Effect.Effect<void, ConnectionFailure>,
  ) {
    if (!isRun(input)) return yield* fail("invalid-input");
    return yield* permits
      .withPermits(1)(
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
              Effect.mapError((error: VaultError | VaultGitHubError | VaultConnectionError) =>
                error._tag === "VaultConnectionError"
                  ? error
                  : new VaultGitHubError({ reason: "unauthorized" }),
              ),
            ),
          });
          return {
            account: current.account,
            repository: input.repository.toLowerCase(),
            ...result,
          };
        }),
      )
      .pipe((effect) =>
        observeVaultHealth(effect, input.id, input.expectedVersion, { kind: "github" }),
      );
  }, Effect.scoped);
  return VaultGitHub.of({
    terminalForAccount: Effect.fn("VaultGitHub.terminalForAccount")(function* (input, account) {
      if (!isTerminal(input) || !githubTerminalArgs(input.repository.toLowerCase(), input.command))
        return yield* new VaultGitHubError({ reason: "invalid-command" });
      const authorize = access
        .authorizeAccount(
          {
            lease: account.lease,
            itemId: input.id,
            expectedVersion: input.expectedVersion,
            action: "use",
            destination: vaultGitHubDestination(input.repository),
          },
          account.authorize,
        )
        .pipe(
          Effect.andThen(() => check(input)),
          Effect.asVoid,
        );
      yield* authorize;
      return yield* permits.withPermits(1)(
        Effect.gen(function* () {
          const record = yield* check(input);
          if (record.stored.credential.type !== "app")
            return yield* new VaultGitHubError({ reason: "account-terminal-unavailable" });
          const current = yield* session(record, input.repository);
          yield* authorize;
          return { account: current.account, token: current.token };
        }),
      );
    }),
    runForAccount: Effect.fn("VaultGitHub.runForAccount")(function* (input, account) {
      const authorize = access
        .authorizeAccount(
          {
            lease: account.lease,
            itemId: input.id,
            expectedVersion: input.expectedVersion,
            action: "use",
            destination: vaultGitHubDestination(input.repository),
          },
          account.authorize,
        )
        .pipe(
          Effect.andThen(() => check(input)),
          Effect.asVoid,
        );
      return yield* runAuthorized(input, authorize);
    }),
    repositoryOperation: Effect.fn("VaultGitHub.repositoryOperation")(function* (
      input,
      operation,
      authorize,
    ) {
      yield* authorize;
      yield* check(input);
      if (Option.isNone(repositoryTransport))
        return yield* new VaultGitHubError({ reason: "unsupported" });
      return yield* permits.withPermits(1)(
        Effect.gen(function* () {
          yield* authorize;
          const record = yield* check(input);
          yield* authorize;
          const current = yield* session(record, input.repository);
          const fresh = authorize.pipe(Effect.andThen(check(input)), Effect.asVoid);
          yield* fresh;
          const output = yield* repositoryTransport.value.execute({
            repository: input.repository.toLowerCase(),
            token: current.token,
            operation,
            authorize: fresh,
          });
          yield* fresh;
          return output;
        }),
      );
    }, Effect.scoped),
    upstreamWorkflow,
    admission: Effect.fn("VaultGitHub.admission")(
      function* (input, threadId) {
        if (!isRun(input)) return yield* fail("invalid-input");
        const authorize = yield* runAuthorization(input, threadId, Effect.void, "observe");
        yield* authorize;
        const record = yield* check(input);
        const thread = yield* threads
          .getThreadShell(threadId)
          .pipe(Effect.mapError(() => fail("denied")));
        yield* authorize;
        // No session minting, CLI/API probes or provider account attestation in local admission.
        return yield* admissionStamp([
          record.info.account,
          record.info.mechanism,
          String(record.info.item.version),
          input.repository.toLowerCase(),
          thread?.activeRunId ?? null,
          thread?.projectId ?? null,
          thread?.providerInstanceId ?? null,
          thread?.worktreePath ?? null,
        ]);
      },
      Effect.catchTags({ VaultConnectionError: () => Effect.fail(fail("denied")) }),
    ),
    info: Effect.fn("VaultGitHub.info")(function (id) {
      return load(id).pipe(Effect.map((r) => r.info));
    }),
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
      if (existing && existing.kind !== "service-connection") return yield* fail("conflict");
      const record = existing ? yield* load(input.id) : null;
      if (!input.credential && (!record || input.expectedVersion === 0))
        return yield* fail("invalid-input");
      const credential = input.credential ?? record!.stored.credential;
      const repositories = [...new Set(input.repositories.map((r) => r.toLowerCase()))].sort();
      const authorizeSave = Effect.gen(function* () {
        yield* authorize;
        const ownerTrusted = (yield* access.snapshot).ownerPolicy?.mode === "owner-trusted";
        if (
          repositories.length >
          (ownerTrusted ? VAULT_GITHUB_OWNER_REPOSITORY_LIMIT : VAULT_GITHUB_REPOSITORY_LIMIT)
        )
          return yield* fail("invalid-input");
      });
      yield* authorizeSave;
      const persist = Effect.fn("VaultGitHub.persistConnection")(function* (account: string) {
        const value = yield* encode({
          schemaVersion: 1,
          provider: "github.com",
          credential,
          account,
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
          authorizeSave,
        );
        return (yield* load(input.id)).info;
      });
      // Let the core recognize an exact replay without minting a new upstream session for a stale edit.
      if (record && record.info.item.version !== input.expectedVersion)
        return yield* persist(record.stored.account);
      if (!record && input.expectedVersion > 0) return yield* fail("conflict");
      if (record && record.info.item.state !== "active") return yield* fail("archived");
      const current = yield* acquireSession(credential, repositories);
      if (
        !input.credential &&
        current.account.toLowerCase() !== record!.stored.account.toLowerCase()
      )
        return yield* fail("conflict");
      for (const repo of repositories) yield* transport.probe(current, repo);
      const saved = yield* persist(current.account);
      yield* observeExpiry(saved, current);
      return saved;
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
      (effect, input) =>
        observeVaultHealth(effect, input.id, input.expectedVersion, { kind: "github" }),
    ),
    change: Effect.fn("VaultGitHub.change")(function* (input, actor, authorize) {
      yield* authorize;
      yield* load(input.id);
      return yield* core.change(input, actor, authorize);
    }),
    terminal: Effect.fn("VaultGitHub.terminal")(function* (raw, threadId) {
      if (!isTerminalInput(raw)) return yield* new VaultGitHubError({ reason: "invalid-command" });
      const sourceWorkload = yield* workloadAuthorization(threadId);
      yield* sourceWorkload;
      const remote = (yield* accountClient.available)
        ? yield* accountClient.terminalCredential(raw, threadId)
        : null;
      const pin =
        remote?.pin ??
        (!("id" in raw) && "connection" in raw
          ? yield* connections.require(
              { kind: "github", connection: raw.connection, repository: raw.repository },
              threadId,
            )
          : null);
      const input = pin
        ? ({
            ...raw,
            id: pin.item.id,
            expectedVersion: pin.item.version,
          } as VaultGitHubTerminalRun)
        : (raw as VaultGitHubTerminalRun);
      if (!isTerminal(input) || !githubTerminalArgs(input.repository.toLowerCase(), input.command))
        return yield* new VaultGitHubError({ reason: "invalid-command" });
      const guard = pin ? connections.revalidate(pin, threadId) : Effect.void;
      const authorize = remote
        ? Effect.gen(function* () {
            yield* sourceWorkload;
            const result = yield* accountClient.execute(
              {
                kind: "resolve",
                input: {
                  kind: "github",
                  connection: { id: remote.pin.item.id, expectedVersion: remote.pin.item.version },
                  repository: input.repository,
                },
              },
              threadId,
            );
            if (
              result.kind !== "resolve" ||
              result.report.state !== "ready" ||
              result.report.selected?.destination !== remote.pin.destination
            )
              return yield* fail("denied");
            yield* sourceWorkload;
          }).pipe(
            Effect.catchTags({
              VaultSshError: () => Effect.fail(new VaultError({ reason: "unavailable" })),
            }),
          )
        : yield* runAuthorization(input, threadId, guard);
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
      return yield* permits
        .withPermits(1)(
          Effect.gen(function* () {
            yield* authorize;
            const current = remote
              ? remote.credential
              : yield* session(yield* check(input), input.repository);
            yield* authorize;
            const result = yield* terminal.execute({
              token: current.token,
              repository: input.repository.toLowerCase(),
              command: input.command,
              cwd,
              authorize: authorize.pipe(
                Effect.mapError((error: VaultError | VaultGitHubError | VaultConnectionError) =>
                  error._tag === "VaultConnectionError"
                    ? error
                    : new VaultGitHubError({ reason: "unauthorized" }),
                ),
              ),
            });
            return {
              account: current.account,
              repository: input.repository.toLowerCase(),
              ...result,
            };
          }),
        )
        .pipe((effect) =>
          observeVaultHealth(effect, input.id, input.expectedVersion, { kind: "github" }),
        );
    }, Effect.scoped),
    readiness: Effect.fn("VaultGitHub.readiness")(
      function* (input, adminAuthorize) {
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
                VaultGitHubError: (error) =>
                  Effect.succeed({ current: null, reason: error.reason }),
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
                effect: Effect.Effect<void, VaultGitHubError | VaultConnectionError>,
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
                          Effect.mapError(
                            (error: VaultError | VaultGitHubError | VaultConnectionError) =>
                              error._tag === "VaultConnectionError"
                                ? error
                                : new VaultGitHubError({ reason: "unauthorized" }),
                          ),
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
      },
      Effect.scoped,
      Effect.catchTags({ VaultConnectionError: () => Effect.fail(fail("denied")) }),
    ),
    run: Effect.fn("VaultGitHub.run")(function* (raw, threadId, guard = Effect.void) {
      if (!isRunInput(raw)) return yield* fail("invalid-input");
      if (yield* accountClient.available) {
        yield* guard;
        const result = yield* accountClient.github(raw, threadId);
        yield* guard.pipe(
          Effect.mapError((error) =>
            result.operationId
              ? new VaultGitHubError({ reason: "failed", operationId: result.operationId })
              : error,
          ),
        );
        return result;
      }
      if (raw.operationId)
        return yield* new VaultGitHubError({
          reason: "receipt-unavailable",
          operationId: raw.operationId,
        });
      const pin =
        !("id" in raw) && "connection" in raw
          ? yield* connections.require(
              { kind: "github", connection: raw.connection, repository: raw.repository },
              threadId,
            )
          : null;
      const input = pin
        ? ({ ...raw, id: pin.item.id, expectedVersion: pin.item.version } as VaultGitHubRun)
        : (raw as VaultGitHubRun);
      const authorize = yield* runAuthorization(
        input,
        threadId,
        pin ? guard.pipe(Effect.andThen(connections.revalidate(pin, threadId))) : guard,
      );
      return yield* runAuthorized(input, authorize);
    }, Effect.scoped),
  });
});
export const layer = Layer.effect(VaultGitHub, make);
