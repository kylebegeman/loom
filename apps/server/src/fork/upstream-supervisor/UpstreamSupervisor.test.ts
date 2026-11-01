import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  ProjectId,
  type AuthClientSession,
} from "@t3tools/contracts";
import {
  UpstreamSupervisorError,
  VaultGitHubError,
  type UpstreamSupervisorConfigInput,
  type UpstreamSupervisorDispatchInput,
  type UpstreamWorkflowRun,
  type UpstreamWorkflowSnapshot,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SessionStore from "../../auth/SessionStore.ts";
import * as ServerConfig from "../../config.ts";
import * as VaultGitHub from "../vault/VaultGitHub.ts";
import * as UpstreamSupervisor from "./UpstreamSupervisor.ts";

const mainSha = "a".repeat(40);
const projectId = ProjectId.make("maintenance-project");
const configuration: UpstreamSupervisorConfigInput = {
  projectId,
  clientSessionId: "chief-session",
  connection: { id: "b".repeat(32), expectedVersion: 2, repository: "acme/loom" },
  enabled: true,
};
const request: UpstreamSupervisorDispatchInput = {
  projectId,
  clientRequestId: "nightly-v1.2.3-main-a",
  targetTag: "v1.2.3-nightly.20261031.1",
  expectedMainSha: mainSha,
};
const owner: UpstreamSupervisor.UpstreamSupervisorActor = {
  sessionId: "owner-session",
  owner: true,
  authorize: Effect.void,
};
const chief: UpstreamSupervisor.UpstreamSupervisorActor = {
  sessionId: configuration.clientSessionId,
  owner: false,
  authorize: Effect.void,
};
const session = (sessionId = configuration.clientSessionId): AuthClientSession => ({
  sessionId: AuthSessionId.make(sessionId),
  subject: "maintenance-chief",
  method: "bearer-access-token",
  client: { label: "Chief", deviceType: "bot" },
  scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
  permissions: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
  issuedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
  expiresAt: DateTime.makeUnsafe("2040-01-01T00:00:00Z"),
  lastConnectedAt: null,
  connected: false,
  current: false,
});
const workflowRun = (marker: string, status = "completed"): UpstreamWorkflowRun => ({
  id: 42,
  attempt: 1,
  status,
  conclusion: status === "completed" ? "success" : null,
  headSha: mainSha,
  url: "https://github.com/acme/loom/actions/runs/42",
  title: `Loom upstream v1.2.3-nightly.20261031.1 [${marker}]`,
  createdAt: "2026-10-31T12:00:00Z",
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fs.makeTempDirectoryScoped();
  const configLayer = ServerConfig.layerTest(process.cwd(), baseDir);
  const serverConfig = yield* ServerConfig.ServerConfig.pipe(Effect.provide(configLayer));
  const statePath = path.join(serverConfig.stateDir, "fork", "upstream-supervisor", "state.json");
  let activeSessions = [session()];
  let snapshot: UpstreamWorkflowSnapshot = { mainSha, runs: [] };
  let beforeStatus: Effect.Effect<void, VaultGitHubError> = Effect.void;
  let afterPost: Effect.Effect<void, VaultGitHubError> = Effect.void;
  let postStatus = 204;
  let posts = 0;
  const layer = UpstreamSupervisor.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(
      Layer.mock(SessionStore.SessionStore)({
        cookieName: "test-session",
        legacyCookieName: undefined,
        listActive: () => Effect.sync(() => activeSessions),
      }),
    ),
    Layer.provide(
      Layer.mock(VaultGitHub.VaultGitHub)({
        info: () =>
          Effect.succeed({
            item: {
              id: configuration.connection.id,
              label: "Nightly connection",
              kind: "service-connection",
              state: "active",
              version: configuration.connection.expectedVersion,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            account: "acme",
            mechanism: "app",
            repositories: [configuration.connection.repository],
          }),
        upstreamWorkflow: (_target, action, authorize) =>
          Effect.gen(function* () {
            yield* authorize;
            if (action.action === "status") {
              yield* beforeStatus;
              yield* authorize;
              return { snapshot, httpStatus: null };
            }
            yield* authorize;
            posts++;
            yield* afterPost;
            return { snapshot, httpStatus: postStatus };
          }),
      }),
    ),
  );
  return {
    service: UpstreamSupervisor.UpstreamSupervisor.pipe(Effect.provide(layer)),
    statePath,
    baseDir,
    posts: () => posts,
    setSessions: (value: AuthClientSession[]) => {
      activeSessions = value;
    },
    setSnapshot: (value: UpstreamWorkflowSnapshot) => {
      snapshot = value;
    },
    setBeforeStatus: (value: Effect.Effect<void, VaultGitHubError>) => {
      beforeStatus = value;
    },
    setAfterPost: (value: Effect.Effect<void, VaultGitHubError>) => {
      afterPost = value;
    },
    setPostStatus: (value: number) => {
      postStatus = value;
    },
  };
});

it.layer(NodeServices.layer)("upstream supervisor", (it) => {
  it.effect(
    "requires owner authorization to configure and rejects expired, revoked or foreign chiefs",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.service;
        expect((yield* service.configure(configuration, chief).pipe(Effect.flip)).reason).toBe(
          "denied",
        );
        expect(
          (yield* service
            .configure(configuration, {
              ...owner,
              authorize: Effect.fail(new UpstreamSupervisorError({ reason: "denied" })),
            })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        yield* service.configure(configuration, owner);
        expect(
          (yield* service
            .dispatch(request, { ...chief, sessionId: "other-chief" })
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        for (const sessions of [
          [],
          [{ ...session(), expiresAt: DateTime.makeUnsafe("1969-01-01T00:00:00Z") }],
          [{ ...session(), permissions: [AuthOrchestrationReadScope] }],
        ]) {
          f.setSessions(sessions);
          expect((yield* service.dispatch(request, chief).pipe(Effect.flip)).reason).toBe("denied");
        }
        expect(f.posts()).toBe(0);
      }),
  );

  it.effect(
    "returns the persisted dispatch after restart and refuses changed inputs or a second key for the same integration",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.service;
        yield* service.configure(configuration, owner);
        const first = yield* service.dispatch(request, chief);
        expect(first.status).toBe("accepted");
        const restarted = yield* f.service;
        expect(yield* restarted.dispatch(request, chief)).toEqual(first);
        expect(
          (yield* restarted.dispatch({ ...request, targetTag: "v1.2.4" }, chief).pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
        expect(
          (yield* restarted
            .dispatch({ ...request, expectedMainSha: "c".repeat(40) }, chief)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        f.setSnapshot({ mainSha, runs: [workflowRun(first.id)] });
        expect((yield* restarted.status(projectId, chief)).receipts[0]?.run?.id).toBe(42);
        expect(
          (yield* restarted
            .dispatch({ ...request, clientRequestId: "new-key-same-integration" }, chief)
            .pipe(Effect.flip)).reason,
        ).toBe("conflict");
        expect(f.posts()).toBe(1);
      }),
  );

  it.effect("refuses stale main and active integrations before admitting another dispatch", () =>
    Effect.gen(function* () {
      for (const scenario of ["stale", "active"] as const) {
        const f = yield* fixture;
        const service = yield* f.service;
        yield* service.configure(configuration, owner);
        f.setSnapshot(
          scenario === "stale"
            ? { mainSha: "c".repeat(40), runs: [] }
            : { mainSha, runs: [workflowRun("d".repeat(64), "in_progress")] },
        );
        expect((yield* service.dispatch(request, chief).pipe(Effect.flip)).reason).toBe(scenario);
        expect(f.posts()).toBe(0);
        expect((yield* service.status(projectId, chief)).receipts).toEqual([]);
      }
    }),
  );

  it.effect.each(["lost reply", "interrupted send"] as const)(
    "does not resend an uncertain dispatch after %s and restart",
    (scenario) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.service;
        yield* service.configure(configuration, owner);
        if (scenario === "lost reply") {
          f.setAfterPost(Effect.fail(new VaultGitHubError({ reason: "unavailable" })));
          expect((yield* service.dispatch(request, chief)).status).toBe("unknown");
        } else {
          const posted = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          f.setAfterPost(
            Deferred.succeed(posted, undefined).pipe(Effect.andThen(Deferred.await(finish))),
          );
          const pending = yield* service.dispatch(request, chief).pipe(Effect.forkScoped);
          yield* Deferred.await(posted);
          yield* Fiber.interrupt(pending);
        }
        const restarted = yield* f.service;
        expect((yield* restarted.dispatch(request, chief)).status).toBe("unknown");
        expect(
          (yield* restarted
            .dispatch({ ...request, clientRequestId: "unknown-bypass" }, chief)
            .pipe(Effect.flip)).reason,
        ).toBe("active");
        expect(f.posts()).toBe(1);
      }),
  );

  it.effect(
    "rechecks the standing grant after a remote wait so disabling control prevents the dispatch",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.service;
        yield* service.configure(configuration, owner);
        const reading = yield* Deferred.make<void>();
        const continueRead = yield* Deferred.make<void>();
        f.setBeforeStatus(
          Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(continueRead))),
        );
        const pending = yield* service
          .dispatch(request, chief)
          .pipe(Effect.result, Effect.forkScoped);
        yield* Deferred.await(reading);
        yield* service.configure({ ...configuration, enabled: false }, owner);
        yield* Deferred.succeed(continueRead, undefined);
        expect((yield* Fiber.join(pending))._tag).toBe("Failure");
        expect(f.posts()).toBe(0);
        expect((yield* service.dispatch(request, chief).pipe(Effect.flip)).reason).toBe("disabled");
      }),
  );

  it.effect(
    "reconciles only the exact run marker and preserves receipts through an explicit chief rebind",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.service;
        yield* service.configure(configuration, owner);
        f.setAfterPost(Effect.fail(new VaultGitHubError({ reason: "unavailable" })));
        const first = yield* service.dispatch(request, chief);
        f.setSnapshot({ mainSha, runs: [workflowRun(`prefix-${first.id}-suffix`)] });
        expect((yield* service.status(projectId, chief)).receipts[0]?.status).toBe("unknown");
        f.setSnapshot({ mainSha, runs: [workflowRun(first.id)] });
        const reconciled = (yield* service.status(projectId, chief)).receipts[0];
        expect(reconciled).toMatchObject({ id: first.id, status: "accepted", run: { id: 42 } });
        f.setSessions([session(), session("new-chief-session")]);
        yield* service.configure({ ...configuration, clientSessionId: "new-chief-session" }, owner);
        expect((yield* service.status(projectId, chief).pipe(Effect.flip)).reason).toBe("denied");
        const rebound = { ...chief, sessionId: "new-chief-session" };
        expect((yield* service.status(projectId, rebound)).receipts).toEqual([reconciled]);
        expect(yield* service.dispatch(request, rebound)).toEqual(reconciled);
        expect(f.posts()).toBe(1);
      }),
  );

  it.effect.each(["write", "file sync"] as const)(
    "does not send or replace prior state when persisting the intent fails at %s",
    (operation) =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const service = yield* f.service;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* service.configure(configuration, owner);
        const before = yield* fs.readFileString(f.statePath);
        const failedFs: FileSystem.FileSystem = {
          ...fs,
          writeFileString: (filePath, contents, options) =>
            fs.writeFileString(
              operation === "write" ? path.join(f.baseDir, "unavailable", "state.json") : filePath,
              contents,
              options,
            ),
          open: (filePath, options) =>
            Effect.gen(function* () {
              const file = yield* fs.open(filePath, options);
              if (operation !== "file sync" || !filePath.endsWith(".pending")) return file;
              const closedFile = yield* Effect.scoped(fs.open(filePath));
              return { ...file, sync: closedFile.sync };
            }),
        };
        const blocked = yield* f.service.pipe(
          Effect.provideService(FileSystem.FileSystem, failedFs),
        );
        expect((yield* blocked.dispatch(request, chief).pipe(Effect.flip)).reason).toBe("storage");
        expect(f.posts()).toBe(0);
        expect(yield* fs.readFileString(f.statePath)).toBe(before);
        expect((yield* service.status(projectId, chief)).receipts).toEqual([]);
      }),
  );

  it.effect(
    "retains evidence while GitHub is unavailable and still lets the owner pause control",
    () =>
      Effect.gen(function* () {
        for (const hasReceipt of [false, true]) {
          const f = yield* fixture;
          const service = yield* f.service;
          const savedConfig = yield* service.configure(configuration, owner);
          const receipt = hasReceipt ? yield* service.dispatch(request, chief) : null;
          f.setBeforeStatus(Effect.fail(new VaultGitHubError({ reason: "unavailable" })));
          const offline = yield* service.status(projectId, chief);
          expect(offline).toMatchObject({
            config: savedConfig,
            unavailable: true,
            mainSha: null,
            runs: [],
            receipts: receipt ? [receipt] : [],
          });
          expect(
            (yield* service
              .dispatch(
                {
                  ...request,
                  clientRequestId: "offline-request",
                  targetTag: "v1.2.4",
                },
                chief,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("unavailable");
          expect(f.posts()).toBe(hasReceipt ? 1 : 0);
          expect(
            yield* service.configure({ ...configuration, enabled: false }, owner),
          ).toMatchObject({ enabled: false });
          expect((yield* service.status(projectId, owner)).config?.enabled).toBe(false);
          expect((yield* service.dispatch(request, chief).pipe(Effect.flip)).reason).toBe(
            "disabled",
          );
        }
      }),
  );

  it.effect("records a known refusal without automatically trying a second dispatch", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const service = yield* f.service;
      yield* service.configure(configuration, owner);
      f.setPostStatus(422);
      const refused = yield* service.dispatch(request, chief);
      expect(refused).toMatchObject({ status: "refused", httpStatus: 422, run: null });
      expect(yield* service.dispatch(request, chief)).toEqual(refused);
      expect(
        (yield* service
          .dispatch({ ...request, clientRequestId: "refusal-bypass" }, chief)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(f.posts()).toBe(1);
    }),
  );
});
