import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthSessionId,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
} from "@t3tools/contracts";
import {
  ACCOUNT_VAULT_ROUTE,
  AccountVaultRequest,
  AccountVaultEnvelope,
  VaultError,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { AccountWorkloads } from "../account-access/AccountWorkloads.ts";
import * as Authority from "./AccountVaultAuthority.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
import { AccountVaultHttpRoutes } from "./account-http.ts";
import * as AccountVaultClient from "./AccountVaultClient.ts";
import * as AccountVaultSsh from "./AccountVaultSsh.ts";

const encode = Schema.encodeEffect(Schema.fromJsonString(AccountVaultRequest));
const encodeEnvelope = Schema.encodeEffect(Schema.fromJsonString(AccountVaultEnvelope));
const dependencies = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, memoryVault);
const publisher = {
  sessionId: AuthSessionId.make("publisher"),
  subject: "loom-host:source",
  method: "bearer-access-token" as const,
  scopes: [AuthLibraryPublishScope],
};
const fixture = Effect.gen(function* () {
  const f = yield* launchFixture(Layer.mock(SshTransport.SshTransport)({}));
  yield* f.access.setOwnerPolicy(
    { operationId: yield* f.id, expectedRevision: 0, mode: "owner-trusted" },
    "admin",
    Effect.void,
  );
  const state = {
    revoked: false,
    lease: {
      sourceEnvironmentId: EnvironmentId.make("source"),
      publisherSessionId: publisher.sessionId,
      authorityId: "authority",
      authorityEpoch: 1,
      keyFingerprint: "a".repeat(64),
      membershipRevision: 1,
      membershipEpoch: 0,
      ownerSubject: "admin",
      expiresAt: Number.MAX_SAFE_INTEGER,
      workload: {
        threadId: f.threadId,
        runId: RunId.make("remote-run"),
        projectId: f.state.thread.projectId,
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
      },
    },
  };
  const authority = yield* Authority.AccountVaultAuthority.pipe(
    Effect.provide(
      Authority.layer.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeedContext(f.context),
            Layer.mock(AccountWorkloads)({
              accept: () => Effect.sync(() => state.lease),
              revalidate: () =>
                Effect.suspend(() =>
                  state.revoked ? Effect.fail(new VaultError({ reason: "denied" })) : Effect.void,
                ),
            }),
          ),
        ),
      ),
    ),
  );
  const call = Effect.fnUntraced(function* (request: AccountVaultRequest) {
    return yield* authority.execute(
      {
        payload: yield* encode(request).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        ),
        proof: "verified-by-workload-service",
      },
      publisher,
    );
  });
  const open = Effect.fnUntraced(function* () {
    const result = yield* call({
      kind: "open",
      input: { kind: "ssh", connection: { id: f.itemId, expectedVersion: 1 } },
    });
    if (result.kind !== "open") return yield* new VaultError({ reason: "invalid-input" });
    return result;
  });
  return { ...f, threadState: f.state, state, call, open, authority };
});

it.effect("brokers public SSH frames only for the enrolled run and current item version", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const inventory = yield* f.call({
      kind: "list",
      input: { cursor: null, includeArchived: false },
    });
    expect(inventory).toMatchObject({
      kind: "list",
      page: { items: [{ id: f.itemId, label: f.key.item.label }] },
    });
    const { session } = yield* f.open();
    expect(session.publicKey).toBe(f.key.publicKey);
    expect(Object.keys(session)).not.toContain("privateKey");
    const input = {
      sessionId: session.sessionId,
      channelId: "a".repeat(32),
      sequence: 0,
      frame: Buffer.from([11]).toString("base64"),
    };
    const original = f.state.lease;
    for (const changed of [
      { ...original, sourceEnvironmentId: EnvironmentId.make("other") },
      { ...original, membershipEpoch: 1 },
      { ...original, workload: { ...original.workload, runId: RunId.make("another-run") } },
    ]) {
      f.state.lease = changed;
      expect((yield* f.call({ kind: "frame", input }).pipe(Effect.flip)).reason).toBe("denied");
    }
    f.state.lease = original;
    const response = yield* f.call({ kind: "frame", input });
    if (response.kind !== "frame") throw new Error("Expected SSH frame");
    expect(Buffer.from(response.response, "base64")[0]).toBe(12);
    expect((yield* f.call({ kind: "frame", input }).pipe(Effect.flip)).reason).toBe(
      "invalid-operation",
    );
    f.state.revoked = true;
    expect(
      (yield* f
        .call({ kind: "list", input: { cursor: null, includeArchived: false } })
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(
      (yield* f.call({ kind: "frame", input: { ...input, sequence: 1 } }).pipe(Effect.flip)).reason,
    ).toBe("denied");
    f.state.revoked = false;
    yield* f.core.change(
      { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
      "admin",
    );
    expect(
      (yield* f.call({ kind: "frame", input: { ...input, sequence: 1 } }).pipe(Effect.flip)).reason,
    ).toBe("conflict");
  }).pipe(Effect.provide(dependencies)),
);

it.effect("closes and expires activations without leaving a reusable signing session", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const first = yield* f.open();
    const second = yield* f.open();
    expect(second.session.sessionId).not.toBe(first.session.sessionId);
    expect(yield* f.call({ kind: "sessions" })).toMatchObject({
      kind: "sessions",
      sessions: [{ sessionId: first.session.sessionId }, { sessionId: second.session.sessionId }],
    });
    expect(yield* f.call({ kind: "close", input: { sessionId: first.session.sessionId } })).toEqual(
      { kind: "close", closed: true },
    );
    expect(
      (yield* f
        .call({ kind: "close", input: { sessionId: first.session.sessionId } })
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect(yield* f.call({ kind: "sessions" })).toMatchObject({
      sessions: [{ sessionId: second.session.sessionId }],
    });
    yield* TestClock.setTime(second.session.expiresAt);
    expect(
      (yield* f
        .call({ kind: "close", input: { sessionId: second.session.sessionId } })
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
  }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "authenticates the HTTP boundary and returns usable public frames and typed refusals",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const runtime = Layer.succeed(
        ForkRuntime,
        Context.make(
          Authority.AccountVaultAuthority,
          f.authority,
        ) as unknown as Context.Context<ForkServices>,
      );
      const web = HttpRouter.toWebHandler(
        AccountVaultHttpRoutes.pipe(
          HttpRouter.provideRequest(
            Layer.mergeAll(
              NodeHttpPlatform.layer,
              runtime,
              Layer.mock(EnvironmentAuth.EnvironmentAuth)({
                authenticateHttpRequest: (request) =>
                  request.headers.authorization === "Bearer machine-only"
                    ? Effect.succeed(publisher)
                    : Effect.fail(new EnvironmentAuth.ServerAuthMissingCredentialError()),
              }),
            ),
          ),
          Layer.provide(NodeServices.layer),
        ),
        { disableLogger: true },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      const send = Effect.fnUntraced(function* (
        input: AccountVaultRequest,
        token = "machine-only",
      ) {
        const payload = yield* encode(input);
        const body = yield* encodeEnvelope({ payload, proof: "verified-workload" });
        return yield* Effect.promise(() =>
          web.handler(
            new Request(`https://library.test${ACCOUNT_VAULT_ROUTE}`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
              body,
            }),
          ),
        );
      });
      expect((yield* send({ kind: "sessions" }, "wrong")).status).toBe(401);
      const opened = yield* send({
        kind: "open",
        input: { kind: "ssh", connection: { id: f.itemId, expectedVersion: 1 } },
      });
      expect(opened.status).toBe(200);
      expect(opened.headers.get("cache-control")).toBe("no-store");
      const openedBody = yield* Effect.promise(() => opened.json());
      expect(openedBody).toMatchObject({ kind: "open", session: { publicKey: f.key.publicKey } });
      f.state.revoked = true;
      const denied = yield* send({ kind: "sessions" });
      expect(denied.status).toBe(403);
      expect(yield* Effect.promise(() => denied.json())).toMatchObject({
        _tag: "VaultError",
        reason: "denied",
      });
    }).pipe(Effect.provide(dependencies)),
);

it.effect(
  "executes on the source with public key metadata and stops when its active run changes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      let changeRun = false;
      const commands: Array<string> = [];
      const source = yield* AccountVaultSsh.AccountVaultSsh.pipe(
        Effect.provide(
          AccountVaultSsh.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeedContext(f.context),
                Layer.mock(AccountVaultClient.AccountVaultClient)({
                  available: Effect.succeed(true),
                  execute: (request) =>
                    f.call(request).pipe(
                      Effect.catchTags({
                        VaultGitHubError: () =>
                          Effect.fail(new VaultError({ reason: "unavailable" })),
                        VaultConnectionError: () =>
                          Effect.fail(new VaultError({ reason: "unavailable" })),
                      }),
                    ),
                }),
                Layer.succeed(SshTransport.SshTransport, {
                  execute: (input) =>
                    Effect.gen(function* () {
                      expect(input.privateKey).toBeUndefined();
                      if (!input.agent) return yield* new VaultError({ reason: "denied" });
                      yield* input.authorize;
                      const frame = yield* input.agent({
                        channelId: "b".repeat(32),
                        sequence: 0,
                        frame: "Cw==",
                      });
                      expect(Buffer.from(frame.response, "base64")[0]).toBe(12);
                      commands.push(
                        "kind" in input.command ? input.command.cwd : input.command.argv[0]!,
                      );
                      if (changeRun)
                        f.threadState.thread = {
                          ...f.threadState.thread,
                          activeRunId: RunId.make("later-run"),
                        };
                      yield* input.authorize;
                      return { exitCode: 0, stdout: "source-result" };
                    }),
                }),
              ),
            ),
          ),
        ),
      );
      expect(
        (yield* source.ssh(
          { id: f.itemId, command: { expectedVersion: 1, argv: ["pwd"], timeoutMs: 1000 } },
          f.threadId,
        )).stdout,
      ).toBe("source-result");
      expect(yield* f.call({ kind: "sessions" })).toMatchObject({ sessions: [] });
      yield* source.git(
        {
          id: f.itemId,
          expectedVersion: 1,
          action: "ls-remote",
          repository: "owner/repo.git",
          timeoutMs: 1000,
        },
        f.threadId,
      );
      expect(commands).toEqual(["pwd", "/private/project"]);
      changeRun = true;
      expect(
        (yield* source
          .ssh(
            { id: f.itemId, command: { expectedVersion: 1, argv: ["pwd"], timeoutMs: 1000 } },
            f.threadId,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }).pipe(Effect.provide(dependencies)),
);
