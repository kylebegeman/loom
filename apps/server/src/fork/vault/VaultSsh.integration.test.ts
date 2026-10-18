// @effect-diagnostics nodeBuiltinImport:off -- Integration fixture inspects disposable public files and socket cleanup with Node filesystem APIs.
import * as NodeFSP from "node:fs/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import { VaultError } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import { sshFixture } from "./VaultSsh.testkit.ts";
import * as SshTransport from "./SshTransport.ts";
import * as SshCrypto from "./SshCrypto.ts";

const configured = Boolean(
  process.env.LOOM_VAULT_TEST_SSH_PORT && process.env.LOOM_VAULT_TEST_OPENBAO_URL,
);
const backend = OpenBaoStore.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    Layer.succeed(HostProcess.Environment, {
      LOOM_VAULT_OPENBAO_URL: process.env.LOOM_VAULT_TEST_OPENBAO_URL,
      LOOM_VAULT_OPENBAO_TOKEN_FILE: process.env.LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE,
    }),
  ),
);
const dependencies = Layer.merge(
  NodeServices.layer,
  backend.pipe(Layer.provide(NodeServices.layer)),
);
const command = {
  expectedVersion: 1,
  argv: ["/usr/bin/printf", "%s", "Loom 'quoted'; $(exit 99)"],
  timeoutMs: 8000,
};
it.live.skipIf(!configured)(
  "executes repeatedly with encrypted keys, refuses changed host trust and fresh revocation, and cleans public files and sockets",
  () =>
    Effect.gen(function* () {
      const temporaryDirectory =
        (yield* HostProcess.Platform) === "darwin" ? "/private/tmp" : process.env.TMPDIR!;
      const f = yield* sshFixture();
      const target = {
        hostname: "127.0.0.1",
        username: process.env.LOOM_VAULT_TEST_SSH_USER!,
        port: Number(process.env.LOOM_VAULT_TEST_SSH_PORT),
        hostKey: process.env.LOOM_VAULT_TEST_SSH_HOST_KEY!,
      };
      const request = {
        id: f.itemId,
        operationId: yield* f.id,
        label: "Disposable SSH key",
        target,
      };
      const key = yield* f.ssh.generate(request, "fixture-admin", Effect.void);
      expect(yield* f.ssh.generate(request, "fixture-admin", Effect.void)).toEqual(key);
      expect(JSON.stringify(key)).not.toContain("PRIVATE KEY");
      yield* Effect.promise(() =>
        NodeFSP.writeFile(process.env.LOOM_VAULT_TEST_SSH_AUTHORIZED_KEYS!, key.publicKey + "\n", {
          mode: 0o600,
        }),
      );
      yield* f.grant(key.destination);
      const session = yield* f.session(key.destination);
      const before = yield* Effect.promise(() => NodeFSP.readdir(temporaryDirectory));
      expect(
        (yield* f.ssh.probe({ id: f.itemId, expectedVersion: 1 }, Effect.void)).authenticated,
      ).toBe(true);
      const proof = yield* f.proof(session, command);
      expect((yield* f.ssh.execute({ proof, command })).stdout).toBe(command.argv[2]);
      expect((yield* f.ssh.execute({ proof, command }).pipe(Effect.flip)).reason).toBe(
        "invalid-proof",
      );
      expect(
        (yield* f.ssh.execute({ proof: yield* f.proof(session, command), command })).exitCode,
      ).toBe(0);
      const otherHost = yield* f.sshKeys.create;
      const trust = {
        id: f.itemId,
        operationId: yield* f.id,
        expectedVersion: 1,
        hostKey: otherHost.publicKey,
      };
      expect((yield* f.ssh.trust(trust, "fixture-admin", Effect.void)).item.version).toBe(2);
      expect((yield* f.ssh.trust(trust, "fixture-admin", Effect.void)).item.version).toBe(2);
      const changed = { ...command, expectedVersion: 2 };
      expect(
        (yield* f.ssh
          .execute({ proof: yield* f.proof(session, changed), command: changed })
          .pipe(Effect.flip)).reason,
      ).toBe("failed");
      yield* f.ssh.trust(
        { ...trust, operationId: yield* f.id, expectedVersion: 2, hostKey: target.hostKey },
        "fixture-admin",
        Effect.void,
      );
      const current = { ...command, expectedVersion: 3 };
      const pending = yield* f.proof(session, current);
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: { type: "state", id: f.grantId, state: "revoked" },
        },
        "fixture-admin",
      );
      expect(
        (yield* f.ssh.execute({ proof: pending, command: current }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* f.workloads.close(session.id, f.threadId);
      const after = yield* Effect.promise(() => NodeFSP.readdir(temporaryDirectory));
      expect(
        after.filter((name) => name.startsWith("loom-ssh-") && !before.includes(name)),
      ).toEqual([]);
      expect(JSON.stringify(yield* f.access.snapshot)).not.toContain("PRIVATE KEY");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  30000,
);

it.live.skipIf(!configured)(
  "bounds time and output and removes operation resources after cancellation",
  () =>
    Effect.gen(function* () {
      const temporaryDirectory =
        (yield* HostProcess.Platform) === "darwin" ? "/private/tmp" : process.env.TMPDIR!;
      const keys = yield* SshCrypto.SshCrypto,
        key = yield* keys.create;
      const target = {
        hostname: "127.0.0.1",
        username: process.env.LOOM_VAULT_TEST_SSH_USER!,
        port: Number(process.env.LOOM_VAULT_TEST_SSH_PORT),
        hostKey: process.env.LOOM_VAULT_TEST_SSH_HOST_KEY!,
      };
      yield* Effect.promise(() =>
        NodeFSP.writeFile(process.env.LOOM_VAULT_TEST_SSH_AUTHORIZED_KEYS!, key.publicKey + "\n", {
          mode: 0o600,
        }),
      );
      const transport = yield* SshTransport.SshTransport;
      const execute = (argv: readonly string[], timeoutMs = 8000) =>
        transport.execute({
          ...key,
          target,
          command: { expectedVersion: 1, argv, timeoutMs },
          authorize: Effect.void,
        });
      expect((yield* execute(["/bin/sleep", "15"], 500).pipe(Effect.flip)).reason).toBe("timeout");
      expect((yield* execute(["/usr/bin/yes"]).pipe(Effect.flip)).reason).toBe("output-limit");
      let checks = 0;
      const revoked = yield* transport
        .execute({
          ...key,
          target,
          command,
          authorize: Effect.suspend(() =>
            ++checks === 1 ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
          ),
        })
        .pipe(Effect.flip);
      expect(revoked.reason).toBe("denied");
      const entered = yield* Deferred.make<void>();
      const before = yield* Effect.promise(() => NodeFSP.readdir(temporaryDirectory));
      const fiber = yield* transport
        .execute({
          ...key,
          target,
          command: { ...command, argv: ["/bin/sleep", "15"] },
          authorize: Deferred.succeed(entered, undefined).pipe(Effect.asVoid),
        })
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      const after = yield* Effect.promise(() => NodeFSP.readdir(temporaryDirectory));
      expect(
        after.filter((name) => name.startsWith("loom-ssh-") && !before.includes(name)),
      ).toEqual([]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.merge(
          NodeServices.layer,
          SshTransport.layer.pipe(
            Layer.provideMerge(SshCrypto.layer),
            Layer.provide(NodeServices.layer),
          ),
        ),
      ),
    ),
  20000,
);
