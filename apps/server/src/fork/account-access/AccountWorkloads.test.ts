import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  AuthLibraryPublishScope,
  AuthSessionId,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import {
  directoryPublicKeyFromPem,
  decodeEd25519PublicKey,
  keyFingerprint,
} from "@t3tools/shared/fork/directory";
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
const publisher = {
  sessionId: PUBLISHER,
  subject: `loom-host:${SOURCE}`,
  method: "bearer-access-token" as const,
  scopes: [AuthLibraryPublishScope],
};

const fixture = Effect.gen(function* () {
  yield* TestClock.setTime(NOW);
  const state = {
    thread: liveThreadShell(THREAD),
    active: true,
    stopAtKeyRead: false,
    authorityEpoch: 1,
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
      current: Effect.succeed({
        kind: "remote",
        origin: "https://library.example.test",
        endpoint: (path) => `https://library.example.test${path}`,
        send: () => Effect.die("not used"),
        credential: {
          version: 1,
          sourceEnvironmentId: SOURCE,
          libraryEnvironmentId: LIBRARY,
          libraryUrl: "https://library.example.test",
          sessionId: PUBLISHER,
          accessToken: Redacted.make("machine-only"),
          expiresAt: "2026-11-13T12:00:00Z",
        },
      }),
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
  return { source, authority, state };
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
        expect((yield* f.source.prepare(PAYLOAD, THREAD).pipe(Effect.flip)).reason).toBe("denied");
      }),
    ),
);
