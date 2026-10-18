import * as BrokerHttpClient from "./BrokerHttpClient.ts";
import { brokerFixture } from "./VaultBrokers.testkit.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { HttpRouter } from "effect/http";
import { VaultBrokerInvitation } from "@t3tools/contracts/fork";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerRunner from "./BrokerRunner.ts";
import { VaultBrokerHttpRoutes } from "./broker-http.ts";

const encodeEffectInvitationJson = Schema.encodeEffect(
  Schema.fromJsonString(VaultBrokerInvitation),
);
it.effect(
  "keeps identity private across process reconstruction and refuses public files or project state",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "loom-broker-identity-" })
        .pipe(Effect.flatMap(fs.realPath));
      const state = path.join(root, "private"),
        project = path.join(root, "project");
      yield* fs.makeDirectory(project);
      const serviceLayer = BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer));
      const identity = yield* BrokerIdentity.BrokerIdentity.pipe(Effect.provide(serviceLayer));
      const first = yield* identity.read(state);
      const second = yield* BrokerIdentity.BrokerIdentity.pipe(
        Effect.flatMap((service) => service.read(state)),
        Effect.provide(serviceLayer),
      );
      expect(second.fingerprint).toBe(first.fingerprint);
      expect((yield* fs.stat(path.join(state, "identity.json"))).mode & 0o077).toBe(0);
      const denied = yield* BrokerIdentity.BrokerIdentity.pipe(
        Effect.flatMap((service) => service.read(path.join(project, "state"))),
        Effect.provide(serviceLayer),
        Effect.provideService(HostProcess.WorkingDirectory, project),
        Effect.flip,
      );
      expect(denied.reason).toBe("local-state");
      yield* fs.chmod(path.join(state, "identity.json"), 0o644);
      expect((yield* identity.read(state).pipe(Effect.flip)).reason).toBe("local-state");
      const serialized = JSON.stringify(first);
      expect(serialized).not.toContain(Redacted.value(first.privateKey));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live(
  "enrolls through real proof HTTP, restarts without an admin token, renews and rejects a disabled machine",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "loom-broker-protocol-" })
        .pipe(Effect.flatMap(fs.realPath));
      const state = path.join(root, "identity");
      const fixture = brokerFixture(),
        context = yield* Layer.build(fixture.layer);
      const brokers = Context.get(context, VaultBrokers.VaultBrokers);
      const app = VaultBrokerHttpRoutes.pipe(
        Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
        HttpRouter.provideRequest(NodeHttpPlatform.layer),
      );
      const web = HttpRouter.toWebHandler(app, { disableLogger: true });
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      const fetch: typeof globalThis.fetch = async (input, init) =>
        web.handler(new Request(input, init));
      const dependencies = Layer.mergeAll(
        BrokerCrypto.layer,
        BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer)),
        BrokerHttpClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      );
      const runnerLayer = BrokerRunner.layer.pipe(
        Layer.provide(dependencies),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
      );
      const runner = yield* BrokerRunner.BrokerRunner.pipe(Effect.provide(runnerLayer));
      const identity = yield* runner.identity(state);
      const invitation = yield* brokers.begin(
        {
          operationId: "a".repeat(32),
          expectedRevision: 0,
          publicKey: identity.publicKey,
          label: "Restartable test broker",
          platform: identity.platform,
        },
        "human",
      );
      const file = path.join(root, "invitation.json");
      yield* fs.writeFileString(file, yield* encodeEffectInvitationJson(invitation));
      const claim = yield* runner.enroll(state, "http://127.0.0.1:12345", file);
      expect((yield* runner.check(state).pipe(Effect.flip)).reason).toBe("approval-pending");
      yield* brokers.apply(
        {
          operationId: "b".repeat(32),
          expectedRevision: 2,
          change: {
            type: "approve",
            enrollmentId: invitation.enrollmentId,
            fingerprint: identity.fingerprint,
          },
        },
        "human",
      );
      const first = yield* runner.check(state);
      expect(first.credentialDelivery).toBe("unsupported");
      const second = yield* BrokerRunner.BrokerRunner.pipe(
        Effect.flatMap((service) => service.check(state)),
        Effect.provide(runnerLayer),
      );
      expect(second.machineId).toBe(claim.machineId);
      expect((yield* brokers.snapshot).machines[0]?.lastSeenAt).not.toBeNull();
      const malformed = yield* Effect.promise(() =>
        web.handler(
          new Request("http://127.0.0.1/api/loom/vault-brokers/heartbeat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        ),
      );
      expect(malformed.status).toBe(400);
      const oversized = yield* Effect.promise(() =>
        web.handler(
          new Request("http://127.0.0.1/api/loom/vault-brokers/claim", {
            method: "POST",
            headers: { "content-type": "application/json", "content-length": "20000" },
            body: "{}",
          }),
        ),
      );
      expect(oversized.status).toBe(413);
      yield* brokers.apply(
        {
          operationId: "c".repeat(32),
          expectedRevision: 3,
          change: { type: "disable", machineId: claim.machineId },
        },
        "human",
      );
      expect((yield* runner.check(state).pipe(Effect.flip)).reason).toBe("disabled");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
