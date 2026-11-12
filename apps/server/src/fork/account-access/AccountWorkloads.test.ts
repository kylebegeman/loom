import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthSessionId,
  EnvironmentId,
  ThreadId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  directoryPublicKeyFromPem,
  decodeEd25519PublicKey,
  keyFingerprint,
} from "@t3tools/shared/fork/directory";
import {
  AccountVaultEnvelope,
  type LibraryError,
  vaultProviderReference,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { HttpClientRequest, HttpClientResponse } from "effect/http";
import * as AccountProviderClient from "../vault/AccountProviderClient.ts";
import { signRelayJwt } from "@t3tools/shared/relayJwt";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { freshComputer, ReachStore, emptyReachLibraryState } from "../reach/library/ReachStore.ts";
import { vaultRun } from "../vault/VaultActiveRun.testkit.ts";
import * as Workloads from "./AccountWorkloads.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const SOURCE = EnvironmentId.make("source-computer");
const LIBRARY = EnvironmentId.make("library");
const THREAD = ThreadId.make("thread");
const PUBLISHER = AuthSessionId.make("publisher");
const PAYLOAD = '{"kind":"inspect","itemId":"account-connection"}';
const decodeEnvelope = Schema.decodeUnknownSync(Schema.fromJsonString(AccountVaultEnvelope));
const publisher = {
  sessionId: PUBLISHER,
  subject: `loom-host:${SOURCE}`,
  method: "bearer-access-token" as const,
  scopes: [AuthLibraryPublishScope],
};

const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(NOW);
  const state = {
    send: (
      _input: HttpClientRequest.HttpClientRequest,
    ): Effect.Effect<HttpClientResponse.HttpClientResponse, LibraryError> =>
      Effect.die("Unexpected send"),
    thread: liveThreadShell(THREAD),
    active: true,
    stopAtKeyRead: false,
    authorityEpoch: 1,
    approvedAuthorityEpoch: 1,
    binding: { authorityId: "authority", authorityEpoch: 1 },
    membershipRevision: 1,
    membershipEpoch: 0,
    membershipState: "active" as "active" | "removing" | "removed",
  };
  const values = new Map<string, Uint8Array>();
  const secrets = Layer.mock(ServerSecretStore)({
    get: (name) =>
      Effect.sync(() => {
        if (state.stopAtKeyRead) state.thread = { ...state.thread, activeRunId: null };
        return Option.fromUndefinedOr(values.get(name));
      }),
    create: (name, value) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
  });
  const key = yield* getOrCreateEnvironmentKeyPairFromSecretStore(
    yield* ServerSecretStore.pipe(Effect.provide(secrets)),
  );
  const publicKey = directoryPublicKeyFromPem(key.publicKey)!;
  const fingerprint = keyFingerprint(decodeEd25519PublicKey(publicKey)!);
  const dependencies = Layer.mergeAll(
    secrets,
    Layer.mock(ThreadManagementService)({
      getThreadShell: () => Effect.sync(() => state.thread),
      getThreadRecords: () =>
        Effect.sync(() => ({
          ...idleThreadProjection(state.thread),
          runs: [vaultRun(state.thread)],
        })),
    }),
    Layer.mock(LibraryPublisher)({
      enabled: false,
      copyRegistrations: Stream.empty,
      info: Effect.sync(() => ({
        environmentId: LIBRARY,
        authorityId: "authority",
        authorityEpoch: state.authorityEpoch,
        isAuthority: true,
        assets: "local" as const,
      })),
    }),
    Layer.mock(LibraryConnectionService)({
      current: Effect.sync(() => ({
        kind: "remote" as const,
        origin: "https://library.example.test",
        endpoint: (path) => `https://library.example.test${path}`,
        send: (input) => state.send(input),
        credential: {
          version: 1 as const,
          account: state.binding,
          sourceEnvironmentId: SOURCE,
          libraryEnvironmentId: LIBRARY,
          libraryUrl: "https://library.example.test",
          sessionId: PUBLISHER,
          accessToken: Redacted.make("machine-only"),
          expiresAt: "2026-11-13T12:00:00Z",
        },
      })),
    }),
    Layer.mock(SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      renewalsOf: (id) => Effect.succeed(new Set([id])),
      listActive: () =>
        Effect.sync(() =>
          state.active
            ? [
                {
                  sessionId: PUBLISHER,
                  subject: publisher.subject,
                  method: "bearer-access-token" as const,
                  scopes: [AuthLibraryPublishScope],
                  client: { label: "Source", deviceType: "unknown" as const },
                  lastConnectedAt: null,
                  issuedAt: DateTime.makeUnsafe(NOW),
                  expiresAt: DateTime.makeUnsafe(NOW + 86400000),
                  current: false,
                  connected: false,
                },
              ]
            : [],
        ),
    }),
    Layer.mock(DirectoryService)({
      pinned: () => Effect.succeed({ publicKey, keyFingerprint: fingerprint, label: "Source" }),
    }),
    Layer.mock(ReachStore)({
      changes: Stream.never,
      read: Effect.sync(() => ({
        ...emptyReachLibraryState,
        computers: {
          [SOURCE]: {
            ...freshComputer("2026-11-12T12:00:00Z"),
            keyFingerprint: fingerprint,
            account: {
              label: "Source",
              authorityId: "authority",
              authorityEpoch: state.approvedAuthorityEpoch,
              ownerSubject: "account-owner",
              requestId: "enrollment",
              approvedAt: state.membershipRevision,
              epoch: state.membershipEpoch,
              state: state.membershipState,
              removedAt: null,
              removalRequestId: null,
              publishingEnded: false,
              routeRemoved: false,
              directoryRemoved: false,
              detail: null,
            },
          },
        },
      })),
    }),
  );
  const open = (environmentId: EnvironmentId) =>
    Workloads.AccountWorkloads.pipe(
      Effect.provide(
        Workloads.layer.pipe(
          Layer.provide(
            Layer.merge(
              dependencies,
              Layer.succeed(ServerEnvironmentIdentity, {
                getEnvironmentId: Effect.succeed(environmentId),
              }),
            ),
          ),
        ),
      ),
    );
  const source = yield* open(SOURCE);
  const authority = yield* open(LIBRARY);
  const forgeCurrentAuthority = (machine = false) =>
    Effect.gen(function* () {
      const crypto = yield* Digest.Digest;
      return yield* signRelayJwt({
        privateKey: key.privateKey,
        typ: "loom-account-workload+jwt",
        payload: {
          iss: SOURCE,
          sub: SOURCE,
          aud: LIBRARY,
          iat: NOW / 1000,
          exp: NOW / 1000 + 30,
          publisherSessionId: PUBLISHER,
          authorityId: "authority",
          authorityEpoch: state.authorityEpoch,
          nonce: "a".repeat(32),
          digest: Hex.encode(
            yield* crypto.digest(Digest.sha256, new TextEncoder().encode(PAYLOAD)),
          ),
          ...(machine
            ? {}
            : {
                workload: {
                  threadId: THREAD,
                  runId: state.thread.activeRunId,
                  projectId: state.thread.projectId,
                  providerInstanceId: state.thread.providerInstanceId,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                },
              }),
        },
      });
    });
  const provider = yield* AccountProviderClient.AccountProviderClient.pipe(
    Effect.provide(
      AccountProviderClient.layer.pipe(
        Layer.provide(
          Layer.merge(
            dependencies,
            Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(SOURCE) }),
          ),
        ),
      ),
    ),
  );
  return { source, authority, provider, state, forgeCurrentAuthority };
});
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(NodeCrypto.layer));

it.effect("admits an exact active workload once and rechecks its online membership lease", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const proof = yield* f.source.prepare(PAYLOAD, THREAD);
      const accepted = yield* f.authority.accept(PAYLOAD, proof, publisher);
      expect(accepted).toMatchObject({
        sourceEnvironmentId: SOURCE,
        ownerSubject: "account-owner",
        membershipEpoch: 0,
        workload: {
          threadId: THREAD,
          runId: f.state.thread.activeRunId,
          projectId: f.state.thread.projectId,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      });
      yield* f.authority.revalidate(accepted);
      expect((yield* f.authority.accept(PAYLOAD, proof, publisher).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      f.state.membershipState = "removing";
      expect((yield* f.authority.revalidate(accepted).pipe(Effect.flip)).reason).toBe("denied");
      f.state.membershipState = "active";
      f.state.membershipEpoch++;
      f.state.membershipRevision++;
      expect((yield* f.authority.revalidate(accepted).pipe(Effect.flip)).reason).toBe("denied");
    }),
  ),
);

it.effect("binds the proof to the payload, publisher session, source key and Library", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const proof = yield* f.source.prepare(PAYLOAD, THREAD);
      for (const input of [
        { payload: `${PAYLOAD} `, publisher },
        {
          payload: PAYLOAD,
          publisher: { ...publisher, sessionId: AuthSessionId.make("another-session") },
        },
        { payload: PAYLOAD, publisher: { ...publisher, subject: "loom-host:another-computer" } },
        { payload: PAYLOAD, publisher: { ...publisher, subject: "mcp-client" } },
        { payload: PAYLOAD, publisher: { ...publisher, scopes: [] } },
      ])
        expect(
          (yield* f.authority.accept(input.payload, proof, input.publisher).pipe(Effect.flip))
            .reason,
        ).toBe("denied");
      expect((yield* f.source.accept(PAYLOAD, proof, publisher).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      expect(
        (yield* f.authority
          .accept(PAYLOAD, `${proof.slice(0, -4)}AAAA`, publisher)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* f.authority.accept(PAYLOAD, proof, publisher);
    }),
  ),
);

it.effect.each(["revoked", "removing", "authority", "expired"] as const)(
  "refuses %s proofs before issuing an account capability",
  (change) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const proof = yield* f.source.prepare(PAYLOAD, THREAD);
        if (change === "revoked") f.state.active = false;
        if (change === "removing") f.state.membershipState = "removing";
        if (change === "authority") f.state.authorityEpoch++;
        if (change === "expired") yield* TestClock.adjust("30 seconds");
        expect(
          (yield* f.authority.accept(PAYLOAD, proof, publisher).pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);

it.effect.each(["restricted", "plan", "ended", "archived", "changed-during-signing"] as const)(
  "does not sign a %s source workload",
  (change) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        if (change === "restricted")
          f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
        if (change === "plan") f.state.thread = { ...f.state.thread, interactionMode: "plan" };
        if (change === "ended") f.state.thread = { ...f.state.thread, activeRunId: null };
        if (change === "archived")
          f.state.thread = { ...f.state.thread, archivedAt: DateTime.makeUnsafe(NOW) };
        if (change === "changed-during-signing") f.state.stopAtKeyRead = true;
        const refusal = yield* f.source.prepare(PAYLOAD, THREAD).pipe(Effect.flip);
        expect(refusal.reason).toBe("denied");
        expect(refusal.detail).toBe(
          change === "restricted" || change === "plan" ? "caller-permission" : "workload-inactive",
        );
      }),
    ),
);

it.effect("requires explicit enrollment repair after a Library revision changes", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      f.state.authorityEpoch = 2;
      expect((yield* f.source.prepare(PAYLOAD, THREAD).pipe(Effect.result))._tag).toBe("Failure");
      expect(
        (yield* f.authority
          .accept(PAYLOAD, yield* f.forgeCurrentAuthority(), publisher)
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      f.state.binding = { authorityId: "authority", authorityEpoch: 2 };
      f.state.approvedAuthorityEpoch = 2;
      const accepted = yield* f.authority.accept(
        PAYLOAD,
        yield* f.source.prepare(PAYLOAD, THREAD),
        publisher,
      );
      expect(accepted.authorityEpoch).toBe(2);
    }),
  ),
);

it.effect("keeps provider machine proofs separate from active workload capabilities", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const machineProof = yield* f.forgeCurrentAuthority(true);
      expect(
        (yield* f.authority.accept(PAYLOAD, machineProof, publisher).pipe(Effect.flip)).reason,
      ).toBe("denied");
      const proof = yield* f.source.prepare(PAYLOAD, THREAD);
      expect(
        (yield* f.authority.acceptProvider(PAYLOAD, proof, publisher).pipe(Effect.flip)).reason,
      ).toBe("denied");
      const g = yield* fixture;
      const lease = yield* g.authority.acceptProvider(
        PAYLOAD,
        yield* g.forgeCurrentAuthority(true),
        publisher,
      );
      expect(lease.ownerSubject).toBe("account-owner");
      g.state.membershipState = "removed";
      expect((yield* g.authority.revalidate(lease).pipe(Effect.flip)).reason).toBe("denied");
    }),
  ),
);

it.effect(
  "authenticates provider credential launches without a run and discards replies after account rebinding",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.state.thread = { ...f.state.thread, activeRunId: null };
        let calls = 0;
        let rebind = false;
        f.state.send = (request) =>
          Effect.gen(function* () {
            calls++;
            if (request.body._tag !== "Uint8Array") throw new Error("Expected JSON request");
            const envelope = decodeEnvelope(new TextDecoder().decode(request.body.body));
            const lease = yield* f.authority
              .acceptProvider(envelope.payload, envelope.proof, publisher)
              .pipe(Effect.orDie);
            expect(lease.ownerSubject).toBe("account-owner");
            if (rebind) f.state.binding = { ...f.state.binding, authorityEpoch: 2 };
            return HttpClientResponse.fromWeb(
              request,
              Response.json({ value: "synthetic-launch-key" }),
            );
          });
        const request = {
          mode: "read" as const,
          reference: vaultProviderReference({
            environmentId: LIBRARY,
            itemId: "b".repeat(32),
            expectedVersion: 1,
          }),
          consumer: { instanceId: ProviderInstanceId.make("provider"), variableName: "API_KEY" },
        };
        const result = yield* f.provider.request(request);
        expect(Redacted.value(result.value!)).toBe("synthetic-launch-key");
        expect(JSON.stringify(result)).not.toContain("synthetic-launch-key");
        rebind = true;
        expect((yield* f.provider.request(request).pipe(Effect.flip)).reason).toBe("denied");
        expect(calls).toBe(2);
      }),
    ),
);
