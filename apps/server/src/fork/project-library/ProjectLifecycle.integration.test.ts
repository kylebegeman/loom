import * as AccountVaultClient from "../vault/AccountVaultClient.ts";
// @effect-diagnostics nodeBuiltinImport:off -- Disposable Git executables redirect only verified fixture destinations.
import * as NodeProcess from "node:process";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import {
  LibraryError,
  SitesError,
  vaultGitHubDestination,
  type LibraryOperationInput,
  type LibraryProject,
  type SiteChecksRunReceipt,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Jose from "jose";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import { directoryPublicKeyFromPem } from "@t3tools/shared/fork/directory";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpRouter from "effect/http/HttpRouter";
import type * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as SqlClient from "effect/sql/SqlClient";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as PocketId from "../../auth/PocketId.ts";
import * as PocketIdHttp from "../../auth/pocketIdHttp.ts";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { liveThreadShell, idleThreadProjection } from "../../mcp/McpToolAccess.testkit.ts";
import { vaultRun } from "../vault/VaultActiveRun.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ProjectPlacement from "../../project/ProjectPlacement.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as WorktreeSetupTracker from "../../project/WorktreeSetupTracker.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { DirectoryService, type DirectoryPin } from "../directory/DirectoryService.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as SitesService from "../sites/SitesService.ts";
import * as GitHubCli from "../vault/GitHubCli.ts";
import * as RepositoryTransport from "../vault/GitHubRepositoryTransport.ts";
import * as GitHubTerminal from "../vault/GitHubTerminal.ts";
import * as GitHubTransport from "../vault/GitHubTransport.ts";
import * as VaultAccess from "../vault/VaultAccess.ts";
import * as VaultCore from "../vault/VaultCore.ts";
import * as VaultConnections from "../vault/VaultConnections.ts";
import * as VaultGitHub from "../vault/VaultGitHub.ts";
import { memoryVault } from "../vault/VaultLaunch.testkit.ts";
import * as ApprovalNotifications from "../vault/ApprovalNotifications.ts";
import { LibraryAssetService } from "./assets/LibraryAssetService.ts";
import { LibraryConnectionService } from "./LibraryConnection.ts";
import * as LibraryGitFetch from "./LibraryGitFetch.ts";
import * as LibraryManagement from "./LibraryManagement.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import * as Catalog from "./LibraryService.ts";
import * as LibraryWorkspace from "./LibraryWorkspace.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as ProjectOperations from "./ProjectOperations.ts";
import * as ProjectWorkflows from "./ProjectWorkflows.ts";
import { LibraryHttpRoutes } from "./http.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const ISSUER = "https://id.lifecycle.test";
const LIBRARY = "https://library.lifecycle.test";
const SITES = "https://sites.lifecycle.test";
const CLIENT_ID = "lifecycle-browser";
const isSitesError = Schema.is(SitesError);
const environmentId = EnvironmentId.make("lifecycle-authority");
const identityEnvironment = {
  LOOM_IDENTITY_ISSUER: ISSUER,
  LOOM_IDENTITY_CLIENT_ID: CLIENT_ID,
  LOOM_IDENTITY_AUDIENCE: LIBRARY,
  LOOM_IDENTITY_REDIRECT_URI: `${LIBRARY}/api/loom/identity/callback`,
  LOOM_IDENTITY_ALLOWED_SUBJECTS: "owner-id,other-id",
};
const authority = Layer.succeed(ServerEnvironmentIdentity, {
  getEnvironmentId: Effect.succeed(environmentId),
});
const authorityConnection = Layer.mock(LibraryConnectionService)({
  current: Effect.succeed({ kind: "authority" }),
});
const threads = Layer.mock(ThreadManagementService)({});
const base = layerMemory.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-lifecycle-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const serve = <
  E,
  R extends HttpRouter.HttpRouter | HttpRouter.Request<"Error", HttpServerError.HttpServerError>,
>(
  routes: Layer.Layer<never, E, R>,
) =>
  Effect.gen(function* () {
    const web = HttpRouter.toWebHandler(routes, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    return web;
  });

const transport = (
  origins: ReadonlyMap<string, Effect.Success<ReturnType<typeof serve>>>,
  afterResponse?: (request: Request, response: Response) => Effect.Effect<void>,
) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const destination = origins.get(new URL(request.url).origin);
      if (destination === undefined) return yield* Effect.die(`Unexpected origin: ${request.url}`);
      const webRequest = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie);
      const response = yield* Effect.promise(() => destination.handler(webRequest));
      yield* afterResponse?.(webRequest, response) ?? Effect.void;
      return HttpClientResponse.fromWeb(request, response);
    }),
  );

const catalogFixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const catalog = yield* Catalog.LibraryService.pipe(
    Effect.provide(
      Catalog.layer.pipe(
        Layer.provide(Layer.mock(LibraryAssetService)({ mode: "local" })),
        Layer.provide(authority),
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
        ),
      ),
    ),
  );
  const workflows = yield* ProjectWorkflows.ProjectWorkflows.pipe(
    Effect.provide(ProjectWorkflows.layer),
    Effect.provideService(Catalog.LibraryService, catalog),
  );
  return { catalog, workflows };
});

const identityFixture = Effect.gen(function* () {
  const pair = yield* Effect.promise(() => Jose.generateKeyPair("RS256"));
  const jwk = yield* Effect.promise(() => Jose.exportJWK(pair.publicKey));
  const codes = new Map<string, { subject: string; nonce: string; challenge: string }>();
  const requested: string[] = [];
  const sign = (subject: string, audience: string, type: string, nonce?: string) =>
    Effect.gen(function* () {
      const now = Math.floor((yield* DateTime.now).epochMilliseconds / 1000);
      return yield* Effect.promise(() =>
        new Jose.SignJWT({ sub: subject, client_id: CLIENT_ID, scope: "openid profile", nonce })
          .setProtectedHeader({ alg: "RS256", kid: "lifecycle-key", typ: type })
          .setIssuer(ISSUER)
          .setAudience(audience)
          .setIssuedAt(now)
          .setExpirationTime(now + 600)
          .sign(pair.privateKey),
      );
    });
  const idp = yield* serve(
    Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/.well-known/openid-configuration",
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
            code_challenge_methods_supported: ["S256"],
          }),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/jwks",
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({
            keys: [{ ...jwk, alg: "RS256", kid: "lifecycle-key", use: "sig" }],
          }),
        ),
      ),
      HttpRouter.add(
        "POST",
        "/token",
        Effect.gen(function* () {
          const input = new URLSearchParams(
            yield* (yield* HttpServerRequest.HttpServerRequest).text,
          );
          expect(input.get("redirect_uri")).toBe(identityEnvironment.LOOM_IDENTITY_REDIRECT_URI);
          expect(input.get("grant_type")).toBe("authorization_code");
          const code = codes.get(input.get("code")!);
          if (!code) return HttpServerResponse.empty({ status: 400 });
          codes.delete(input.get("code")!);
          const verifier = new TextEncoder().encode(input.get("code_verifier")!);
          const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", verifier));
          expect(Buffer.from(digest).toString("base64url")).toBe(code.challenge);
          return HttpServerResponse.jsonUnsafe({
            token_type: "Bearer",
            access_token: yield* sign(code.subject, LIBRARY, "at+jwt"),
            id_token: yield* sign(code.subject, CLIENT_ID, "JWT", code.nonce),
          });
        }),
      ),
    ),
  );
  const client = transport(new Map([[ISSUER, idp]]), (request) =>
    Effect.sync(() => {
      requested.push(new URL(request.url).pathname);
    }),
  );
  const sessions = yield* SessionStore.SessionStore.pipe(
    Effect.provide(
      SessionStore.layer.pipe(Layer.provide(Layer.merge(ServerSecretStore.layer, authority))),
    ),
    Effect.provideService(HostProcess.Environment, identityEnvironment),
  );
  const identity = yield* PocketId.PocketId.pipe(
    Effect.provide(PocketId.layer.pipe(Layer.provide(ServerSecretStore.layer))),
    Effect.provideService(SessionStore.SessionStore, sessions),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(HostProcess.Environment, identityEnvironment),
    Effect.provide(authority),
  );
  const web = yield* serve(
    PocketIdHttp.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PocketId.PocketId, identity),
          Layer.succeed(SessionStore.SessionStore, sessions),
        ),
      ),
      HttpRouter.provideRequest(NodeHttpPlatform.layer),
      Layer.provide(NodeServices.layer),
    ),
  );
  const login = (subject: string, code: string) =>
    Effect.gen(function* () {
      const begun = yield* Effect.promise(() =>
        web.handler(new Request(`${LIBRARY}/api/loom/identity/login?returnTo=/projects`)),
      );
      expect(begun.status).toBe(302);
      const authorization = new URL(begun.headers.get("location")!);
      expect(authorization.origin).toBe(ISSUER);
      const cookie = begun.headers
        .getSetCookie()
        .find((value) => value.startsWith(`${identity.cookieName}=`))!;
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      codes.set(code, {
        subject,
        nonce: authorization.searchParams.get("nonce")!,
        challenge: authorization.searchParams.get("code_challenge")!,
      });
      const callback = yield* Effect.promise(() =>
        web.handler(
          new Request(
            `${LIBRARY}/api/loom/identity/callback?state=${authorization.searchParams.get("state")}&code=${code}`,
            { headers: { cookie: cookie.split(";")[0]! } },
          ),
        ),
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe("/projects");
      const grant = callback.headers
        .getSetCookie()
        .find((value) => value.startsWith(`${sessions.cookieName}=`))!;
      expect(grant).toContain("Secure");
      expect(grant).toContain("HttpOnly");
      return yield* sessions.verify(
        decodeURIComponent(grant.split(";")[0]!.slice(sessions.cookieName.length + 1)),
      );
    });
  return { sessions, login, requested };
});

it.live(
  "signs in through real OIDC HTTP and recovers a committed create for the same account only",
  () =>
    Effect.gen(function* () {
      const { catalog, workflows } = yield* catalogFixture;
      const identity = yield* identityFixture;
      const sql = yield* SqlClient.SqlClient;
      const signedIn = yield* identity.login("owner-id", "first-login");
      expect(yield* catalog.projects({})).toEqual([]);
      expect(yield* sql`SELECT id FROM fork_library_operations`).toEqual([]);
      expect(yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`).toEqual([]);
      expect(identity.requested).toContain("/.well-known/openid-configuration");
      expect(identity.requested).toContain("/jwks");
      const dependencies = Layer.mergeAll(
        Layer.succeed(Catalog.LibraryService, catalog),
        Layer.succeed(ProjectWorkflows.ProjectWorkflows, workflows),
        Layer.succeed(SessionStore.SessionStore, identity.sessions),
        Layer.succeed(HostProcess.Environment, identityEnvironment),
        authority,
        authorityConnection,
        threads,
        ServerSecretStore.layer,
        Layer.mock(DirectoryService)({}),
        Layer.mock(LibraryPublisher)({ enabled: true }),
        Layer.mock(SitesService.SitesService)({}),
      );
      const manager = yield* LibraryManagement.LibraryManagement.pipe(
        Effect.provide(LibraryManagement.layer.pipe(Layer.provide(dependencies))),
      );
      const operationsLayer = ProjectOperations.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            dependencies,
            Layer.succeed(LibraryManagement.LibraryManagement, manager),
            Layer.mock(LibraryWorkspace.LibraryWorkspace)({}),
            LibraryWorkspaceStore.layer,
            Layer.mock(GitWorkflowService)({}),
          ),
        ),
      );
      const operations = Context.get(
        yield* Layer.build(operationsLayer),
        ProjectOperations.ProjectOperations,
      );
      const request: LibraryOperationInput = {
        kind: "create",
        input: { requestId: "create-once", title: "Verified project" },
      };
      const id = yield* operations.operationId(request.input.requestId, request.kind);
      // The response is lost only after the operation and authority have committed their receipts.
      const lost = yield* operations.executeClient(id, request, signedIn.sessionId).pipe(
        Effect.tap((result) => Effect.sync(() => expect(result.state).toBe("succeeded"))),
        Effect.andThen(Effect.fail(new LibraryError({ reason: "io" }))),
        Effect.result,
      );
      expect(lost._tag).toBe("Failure");
      const reconnected = yield* identity.login("owner-id", "second-login");
      expect(reconnected.sessionId).not.toBe(signedIn.sessionId);
      const restarted = Context.get(
        yield* Layer.build(Layer.fresh(operationsLayer)),
        ProjectOperations.ProjectOperations,
      );
      const recovered = yield* restarted.outcomeClient(
        { kind: "create", requestId: request.input.requestId },
        reconnected.sessionId,
      );
      expect(recovered).toMatchObject({ id, state: "succeeded", kind: "create" });
      expect(
        yield* restarted.outcomeClient(
          { kind: "create", requestId: "another-request" },
          reconnected.sessionId,
        ),
      ).toBe(null);
      const other = yield* identity.login("other-id", "other-login");
      expect(
        yield* restarted.outcomeClient(
          { kind: "create", requestId: request.input.requestId },
          other.sessionId,
        ),
      ).toBe(null);
      expect(yield* operations.executeClient(id, request, signedIn.sessionId)).toEqual(recovered);
      const projects = yield* catalog.projects({});
      expect(projects).toHaveLength(1);
      expect(projects[0]!.title).toBe("Verified project");
      expect(yield* sql`SELECT id FROM fork_library_operations`).toEqual([{ id }]);
      expect(yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(base)),
);

const git = (cwd: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    const output = yield* runner.run({
      command: "/usr/bin/git",
      cwd,
      args,
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    expect(output.code, output.stderr).toBe(0);
    return output.stdout.trim();
  });

it.live(
  "prepares actual files through real workspace, fetch, pinned Vault policy and scoped Git transport",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "lifecycle-git-" }),
      );
      const source = path.join(root, "source");
      const bare = path.join(root, "repository.git");
      const log = path.join(root, "transport.jsonl");
      yield* fs.makeDirectory(source);
      yield* git(source, ["init", "--initial-branch=main"]);
      yield* fs.writeFileString(path.join(source, "README.md"), "verified repository files\n");
      yield* git(source, ["add", "."]);
      yield* git(source, [
        "-c",
        "user.name=Lifecycle fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "Fixture",
      ]);
      const head = yield* git(source, ["rev-parse", "HEAD"]);
      yield* git(root, ["clone", "--bare", "--", source, bare]);
      yield* fs.writeFileString(
        path.join(root, "git"),
        `#!${NodeProcess.execPath}
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
const remote = 'https://github.com/owner/repo.git';
assert.equal(args[args.indexOf('--') + 1], remote);
assert.equal(process.env.GITHUB_TOKEN, undefined);
assert.equal(process.env.SSH_AUTH_SOCK, undefined);
const fill = path => cp.spawnSync('/usr/bin/git', ['credential', 'fill'], { env: process.env, input: 'protocol=https\\nhost=github.com\\npath=' + path + '\\n\\n', encoding: 'utf8' });
const allowed = fill('owner/repo.git');
assert.equal(allowed.status, 0);
assert.ok(allowed.stdout.includes('password=' + process.env.LOOM_GITHUB_TOKEN));
assert.notEqual(fill('another/repo.git').status, 0);
const config = Object.fromEntries(Array.from({ length: Number(process.env.GIT_CONFIG_COUNT) }, (_, i) => [process.env['GIT_CONFIG_KEY_' + i], process.env['GIT_CONFIG_VALUE_' + i]]));
assert.equal(config['http.sslVerify'], 'true');
assert.equal(config['http.followRedirects'], 'false');
assert.equal(config['protocol.allow'], 'never');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ home: process.env.HOME, args }) + '\\n');
const localArgs = ['-c', 'protocol.file.allow=always', ...args.map(arg => arg === remote ? ${JSON.stringify(bare)} : arg)];
const result = cp.spawnSync('/usr/bin/git', localArgs, { env: process.env, stdio: 'inherit' });
if (result.status === 0 && args.includes('clone')) {
  const target = args.at(-1);
  const configured = cp.spawnSync('/usr/bin/git', ['-C', target, 'remote', 'set-url', 'origin', remote], { env: process.env });
  assert.equal(configured.status, 0);
}
process.exit(result.status ?? 1);
`,
        { mode: 0o700 },
      );
      const host = Layer.succeed(HostProcess.Environment, {
        PATH: `${root}:/usr/bin:/bin`,
        GITHUB_TOKEN: "must-not-reach-git",
        SSH_AUTH_SOCK: "/unused-personal-agent",
      });
      const thread = liveThreadShell(ThreadId.make("repository-authorizer"));
      const vaultDependencies = Layer.mergeAll(
        Layer.mock(AccountVaultClient.AccountVaultClient)({ available: Effect.succeed(false) }),
        authority,
        Layer.mock(ThreadManagementService)({
          getThreadShell: () => Effect.succeed(thread),
          getThreadRecords: () =>
            Effect.succeed({ ...idleThreadProjection(thread), runs: [vaultRun(thread)] }),
        }),
        Layer.mock(ProjectStoreV2)({}),
        memoryVault,
        host,
      );
      const core = VaultCore.layer.pipe(Layer.provide(vaultDependencies));
      const access = VaultAccess.layer.pipe(
        Layer.provide(Layer.mergeAll(core, vaultDependencies, ApprovalNotifications.stub)),
      );
      const vaultBase = Layer.mergeAll(core, access, vaultDependencies);
      let acquired = 0;
      let released = 0;
      const vaultContext = yield* Layer.build(
        VaultGitHub.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              vaultBase,
              VaultConnections.layer.pipe(Layer.provide(vaultBase)),
              RepositoryTransport.layer.pipe(Layer.provide(host)),
              Layer.mock(GitHubCli.GitHubCli)({}),
              Layer.mock(GitHubTerminal.GitHubTerminal)({}),
              Layer.succeed(GitHubTransport.GitHubTransport, {
                session: () =>
                  Effect.sync(() => {
                    acquired++;
                    return {
                      account: "fixture-owner",
                      token: Redacted.make("synthetic-scoped-token"),
                      expiresAt: null,
                    };
                  }),
                release: () =>
                  Effect.sync(() => {
                    released++;
                  }),
                probe: () => Effect.void,
              }),
            ),
          ),
        ),
      );
      const vault = Context.get(vaultContext, VaultGitHub.VaultGitHub);
      const saved = yield* vault.save(
        {
          id: "a".repeat(32),
          operationId: "b".repeat(32),
          expectedVersion: 0,
          label: "Fixture GitHub",
          repositories: ["owner/repo"],
          credential: { type: "token", token: Redacted.make("synthetic-stored-token") },
        },
        "fixture-owner",
        Effect.void,
      );
      const selected = {
        kind: "vault-github" as const,
        id: saved.item.id,
        expectedVersion: saved.item.version,
        repository: "owner/repo",
      };
      const policy = Context.get(vaultContext, VaultAccess.VaultAccess);
      const grant = yield* policy.apply(
        {
          operationId: "c".repeat(32),
          expectedRevision: 0,
          change: {
            type: "save",
            grant: {
              id: "d".repeat(32),
              label: "Repository authorization",
              principal: { kind: "thread", id: thread.id },
              itemIds: [selected.id],
              actions: ["use"],
              projectId: null,
              destination: vaultGitHubDestination(selected.repository),
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "fixture-owner",
      );
      const oldVault = Context.get(
        yield* Layer.build(
          VaultGitHub.layer.pipe(
            Layer.provide(
              Layer.succeedContext(
                vaultContext.pipe(Context.omit(RepositoryTransport.GitHubRepositoryTransport)),
              ),
            ),
          ),
        ),
        VaultGitHub.VaultGitHub,
      );
      const oldFetch = yield* LibraryGitFetch.LibraryGitFetch.pipe(
        Effect.provide(LibraryGitFetch.layer),
        Effect.provideService(VaultGitHub.VaultGitHub, oldVault),
        Effect.provide(host),
      );
      const fetch = yield* LibraryGitFetch.LibraryGitFetch.pipe(
        Effect.provide(LibraryGitFetch.layer),
        Effect.provideService(VaultGitHub.VaultGitHub, vault),
        Effect.provide(host),
      );
      const placements = ProjectPlacement.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            ServerSettings.layerTest(),
            GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer)),
            Layer.mock(ProjectStoreV2)({ list: () => Effect.succeed([]) }),
            Layer.succeed(ProjectPlacement.LanesRoots, { roots: Effect.succeed([]) }),
            ProjectPlacement.layerLibraryCopyRoots,
          ),
        ),
      );
      const dependencies = Layer.mergeAll(
        authority,
        LibraryWorkspaceStore.layer,
        WorktreeSetupTracker.layer,
        Layer.mock(VcsStatusBroadcaster)({}),
        placements,
        GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer)),
        ServerSettings.layerTest(),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 1,
              snapshotSequence: 0,
              threads: [],
              archivedThreads: [],
            }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getByWorkspaceRoot: () => Effect.succeedNone,
          bootstrap: (input) =>
            Effect.succeed({ created: true, project: { id: input.projectId } as never }),
          listShells: () => Effect.succeed([]),
        }),
      );
      const workspaceFor = (fetcher: LibraryGitFetch.LibraryGitFetch["Service"]) =>
        Layer.build(
          LibraryWorkspace.layer.pipe(
            Layer.provide(
              Layer.mergeAll(dependencies, Layer.succeed(LibraryGitFetch.LibraryGitFetch, fetcher)),
            ),
          ),
        ).pipe(Effect.map((context) => Context.get(context, LibraryWorkspace.LibraryWorkspace)));
      const workspace = yield* workspaceFor(fetch);
      const oldWorkspace = yield* workspaceFor(oldFetch);
      const project: LibraryProject = {
        id: "git-project",
        title: "Git project",
        brief: "",
        revision: 1,
        archived: false,
        resources: [
          {
            id: "repo",
            title: "Repository",
            relativePath: ".",
            remoteUrl: "https://github.com/owner/repo.git",
            defaultBranch: "main",
          },
        ],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      let authorized = 0;
      const authorize: RepositoryTransport.RepositoryAuthorizer = (target) =>
        Effect.sync(() => {
          expect(target).toEqual(selected);
          authorized++;
        }).pipe(
          Effect.andThen(
            policy.require(thread.id, target.id, "use", vaultGitHubDestination(target.repository)),
          ),
        );
      const request = {
        requestId: "vault-files",
        project,
        rootPath: path.join(root, "checkout"),
        strategy: "clone" as const,
        repositoryAccess: [{ resourceId: "repo", access: selected }],
      };
      const copy = yield* workspace.prepareCopy(request, authorize);
      expect(copy.state).toBe("ready");
      expect(yield* fs.readFileString(path.join(copy.rootPath, "README.md"))).toBe(
        "verified repository files\n",
      );
      expect(yield* git(copy.rootPath, ["rev-parse", "HEAD"])).toBe(head);
      expect(yield* git(copy.rootPath, ["remote", "get-url", "origin"])).toBe(
        project.resources[0]!.remoteUrl,
      );
      expect(yield* fetch.mirrorLocations).toEqual([]);
      expect(authorized).toBeGreaterThan(1);
      const events = (yield* fs.readFileString(log))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { home: string; args: string[] });
      expect(events.some((event) => event.args.includes("ls-remote"))).toBe(true);
      expect(events.filter((event) => event.args.includes("clone"))).toHaveLength(1);
      for (const event of events) expect(yield* fs.exists(event.home)).toBe(false);
      expect(acquired).toBe(released);
      const count = events.length;
      yield* policy.apply(
        {
          operationId: "e".repeat(32),
          expectedRevision: (yield* policy.snapshot).revision,
          change: { type: "state", id: grant.definition.id, state: "revoked" },
        },
        "fixture-owner",
      );
      const rejected = [
        {
          suffix: "revoked",
          access: selected,
          workspace,
          authorize,
        },
        {
          suffix: "stale-pin",
          workspace,
          access: { ...selected, expectedVersion: selected.expectedVersion + 1 },
          authorize: () => Effect.void,
        },
        {
          suffix: "unsupported",
          access: selected,
          workspace: oldWorkspace,
          authorize: () => Effect.void,
        },
      ];
      for (const row of rejected) {
        const rootPath = path.join(root, row.suffix);
        const failure = yield* row.workspace
          .prepareCopy(
            {
              ...request,
              requestId: row.suffix,
              rootPath,
              repositoryAccess: [{ resourceId: "repo", access: row.access }],
            },
            row.authorize,
          )
          .pipe(Effect.flip);
        expect(failure.reason).toBe("blocked");
        expect(yield* fs.exists(rootPath)).toBe(false);
        expect(yield* row.workspace.preparation({ requestId: row.suffix })).toBe(null);
      }
      expect((yield* fs.readFileString(log)).trim().split("\n")).toHaveLength(count);
      expect(yield* fetch.mirrorLocations).toEqual([]);
      expect(acquired).toBe(released);
    }).pipe(Effect.scoped, Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(base)))),
);

it.live(
  "forwards signed Sites management and receipt reads through real Library HTTP without repeating a lost run",
  () =>
    Effect.gen(function* () {
      const { catalog, workflows } = yield* catalogFixture;
      const snapshot = {
        schemaVersion: 1 as const,
        primarySiteId: "fixture-site",
        observedAt: "2026-01-01T00:00:00Z",
        staleAfterSeconds: 900,
        sites: [],
        services: [],
        checks: [],
      };
      const receipts = new Map<string, SiteChecksRunReceipt>();
      let runs = 0;
      let receiptStatus = 200;
      let drop = true;
      const sitesWeb = yield* serve(
        Layer.mergeAll(
          HttpRouter.add(
            "POST",
            "/api/oidc/token",
            Effect.gen(function* () {
              const body = new URLSearchParams(
                yield* (yield* HttpServerRequest.HttpServerRequest).text,
              );
              expect(body.get("client_id")).toBe("synthetic-manager");
              expect(body.get("scope")).toBe("sites:write");
              return HttpServerResponse.jsonUnsafe({
                access_token: "synthetic-sites-token",
                token_type: "Bearer",
                expires_in: 300,
              });
            }),
          ),
          HttpRouter.add(
            "POST",
            "/v1/integrations/sites/checks/run",
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              expect(request.headers.authorization).toBe("Bearer synthetic-sites-token");
              const requestId = request.headers["idempotency-key"]!;
              if (!receipts.has(requestId)) {
                runs++;
                receipts.set(requestId, { state: "completed", status: 200, body: snapshot });
              }
              return HttpServerResponse.jsonUnsafe(snapshot);
            }),
          ),
          HttpRouter.add(
            "GET",
            "/v1/integrations/sites/checks/run/receipt",
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              expect(request.headers.authorization).toBe("Bearer synthetic-sites-token");
              if (receiptStatus !== 200) return HttpServerResponse.empty({ status: receiptStatus });
              return HttpServerResponse.jsonUnsafe(
                receipts.get(request.headers["idempotency-key"]!) ?? { state: "absent" },
              );
            }),
          ),
        ),
      );
      const sitesHttp = HttpClient.make((request) =>
        Effect.gen(function* () {
          const origin = new URL(request.url).origin;
          if (origin !== ISSUER && origin !== SITES)
            return yield* Effect.die(`Unexpected Sites origin: ${request.url}`);
          const webRequest = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie);
          const response = yield* Effect.promise(() => sitesWeb.handler(webRequest));
          return HttpClientResponse.fromWeb(request, response);
        }),
      );
      const service = yield* SitesService.SitesService.pipe(
        Effect.provide(SitesService.layer),
        Effect.provideService(HttpClient.HttpClient, sitesHttp),
        Effect.provide(authorityConnection),
        Effect.provideService(Catalog.LibraryService, catalog),
        Effect.provideService(HostProcess.Environment, {
          LOOM_IDENTITY_ISSUER: ISSUER,
          LOOM_SITES_API_ORIGIN: SITES,
          LOOM_SITES_CLIENT_ID: "synthetic-reader",
          LOOM_SITES_CLIENT_SECRET: "synthetic-reader-secret",
          LOOM_SITES_MANAGER_CLIENT_ID: "synthetic-manager",
          LOOM_SITES_MANAGER_CLIENT_SECRET: "synthetic-manager-secret",
        }),
      );
      const sessionContext = yield* Layer.build(
        SessionStore.layer.pipe(
          Layer.provideMerge(ServerSecretStore.layer),
          Layer.provide(authority),
          Layer.provide(Layer.succeed(HostProcess.Environment, {})),
        ),
      );
      const sessions = Context.get(sessionContext, SessionStore.SessionStore);
      const owner = yield* sessions.issue({
        subject: "owner",
        method: "bearer-access-token",
        scopes: [AuthSettingsWriteScope],
      });
      const ownerSession = (yield* sessions.listActive()).find(
        (entry) => entry.sessionId === owner.sessionId,
      )!;
      const computerId = EnvironmentId.make("sites-computer");
      const pins = new Map<EnvironmentId, DirectoryPin>();
      const managementDependencies = Layer.mergeAll(
        Layer.succeed(Catalog.LibraryService, catalog),
        Layer.succeed(ProjectWorkflows.ProjectWorkflows, workflows),
        Layer.succeed(SitesService.SitesService, service),
        Layer.succeed(SessionStore.SessionStore, sessions),
        Layer.succeed(HostProcess.Environment, {}),
        Layer.mock(LibraryPublisher)({ enabled: true, info: catalog.info }),
        Layer.mock(DirectoryService)({ pinned: (id) => Effect.sync(() => pins.get(id) ?? null) }),
        threads,
      );
      const receiver = Context.get(
        yield* Layer.build(
          LibraryManagement.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                managementDependencies,
                authorityConnection,
                authority,
                Layer.succeed(
                  ServerSecretStore.ServerSecretStore,
                  Context.get(sessionContext, ServerSecretStore.ServerSecretStore),
                ),
              ),
            ),
          ),
        ),
        LibraryManagement.LibraryManagement,
      );
      const runtime = Context.make(Catalog.LibraryService, catalog).pipe(
        Context.add(ProjectWorkflows.ProjectWorkflows, workflows),
        Context.add(SitesService.SitesService, service),
        Context.add(LibraryManagement.LibraryManagement, receiver),
      );
      let session: EnvironmentAuth.AuthenticatedSession | null = {
        sessionId: AuthSessionId.make("computer"),
        subject: `loom-host:${computerId}`,
        method: "bearer-access-token",
        scopes: [AuthLibraryPublishScope],
      };
      const libraryWeb = yield* serve(
        LibraryHttpRoutes.pipe(
          Layer.provide(Layer.succeed(ForkRuntime, runtime as Context.Context<ForkServices>)),
          HttpRouter.provideRequest(
            Layer.mergeAll(
              NodeHttpPlatform.layer,
              Layer.mock(EnvironmentAuth.EnvironmentAuth)({
                authenticateHttpRequest: () =>
                  Effect.suspend(() =>
                    session
                      ? Effect.succeed(session)
                      : Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError()),
                  ),
              }),
            ),
          ),
        ),
      );
      const http = transport(new Map([[LIBRARY, libraryWeb]]));
      const connection = Layer.mock(LibraryConnectionService)({
        current: Effect.succeed({
          kind: "remote",
          origin: LIBRARY,
          credential: null,
          endpoint: (path) => `${LIBRARY}${path}`,
          send: () => Effect.die("Use the managed connection"),
        }),
        send: (request) =>
          http.execute(HttpClientRequest.setUrl(request, new URL(request.url, LIBRARY))).pipe(
            Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
            Effect.flatMap((response) =>
              Effect.gen(function* () {
                if (request.url.endsWith("/manage") && drop && response.status === 200) {
                  drop = false;
                  yield* response.text.pipe(
                    Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
                  );
                  return yield* new LibraryError({ reason: "io" });
                }
                return response;
              }),
            ),
          ),
      });
      const remote = yield* SitesService.SitesService.pipe(
        Effect.provide(
          SitesService.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                connection,
                Layer.succeed(HttpClient.HttpClient, http),
                Layer.succeed(Catalog.LibraryService, catalog),
                Layer.succeed(HostProcess.Environment, {}),
              ),
            ),
          ),
        ),
      );
      const computerSecrets = Context.get(
        yield* Layer.build(
          ServerSecretStore.layer.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "lifecycle-computer-" })),
          ),
        ),
        ServerSecretStore.ServerSecretStore,
      );
      const computer = Context.get(
        yield* Layer.build(
          LibraryManagement.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                managementDependencies,
                connection,
                Layer.succeed(ServerEnvironmentIdentity, {
                  getEnvironmentId: Effect.succeed(computerId),
                }),
                Layer.succeed(ServerSecretStore.ServerSecretStore, computerSecrets),
              ),
            ),
          ),
        ),
        LibraryManagement.LibraryManagement,
      );
      const status = yield* computer.status;
      const keys = yield* getOrCreateEnvironmentKeyPairFromSecretStore(computerSecrets);
      pins.set(computerId, {
        publicKey: directoryPublicKeyFromPem(keys.publicKey)!,
        keyFingerprint: status.keyFingerprint,
        label: "Sites computer",
      });
      yield* computer.install(
        yield* receiver.issue(
          { environmentId: computerId, keyFingerprint: status.keyFingerprint },
          ownerSession,
        ),
      );
      const requestId = "original-check-run";
      const lost = yield* computer
        .sites(
          { action: "runChecks", input: { requestId } },
          { kind: "client", sessionId: owner.sessionId },
        )
        .pipe(Effect.flip);
      expect(lost.reason).toBe("io");
      expect(isSitesError(lost.cause) && lost.cause.stage).toBe("unknown-outcome");
      expect(isSitesError(lost.cause) && lost.cause.requestId).toBe(requestId);
      expect(runs).toBe(1);
      expect(yield* remote.checkRunReceipt({ requestId })).toEqual({
        state: "completed",
        status: 200,
        body: snapshot,
      });
      for (const [status, stage] of [
        [401, "authentication"],
        [403, "permission"],
        [422, "request-conflict"],
      ] as const) {
        receiptStatus = status;
        const failure = yield* remote.checkRunReceipt({ requestId }).pipe(Effect.flip);
        expect(failure.stage).toBe(stage);
        expect(failure.requestId).toBe(requestId);
      }
      receiptStatus = 404;
      expect(yield* remote.checkRunReceipt({ requestId })).toEqual({ state: "unavailable" });
      receiptStatus = 200;
      for (const state of ["pending", "unavailable"] as const) {
        receipts.set(requestId, { state });
        expect(yield* remote.checkRunReceipt({ requestId })).toEqual({ state });
      }
      // An expired retained receipt leaves the original mutation unresolved.
      receipts.delete(requestId);
      expect(yield* remote.checkRunReceipt({ requestId })).toEqual({ state: "absent" });
      session = null;
      expect((yield* remote.checkRunReceipt({ requestId }).pipe(Effect.flip)).stage).toBe(
        "library-connection",
      );
      expect(runs).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(base)),
);
