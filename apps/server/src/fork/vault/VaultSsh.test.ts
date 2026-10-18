import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { HttpRouter } from "effect/http";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerHttpClient from "./BrokerHttpClient.ts";
import * as WorkloadRunner from "./WorkloadRunner.ts";
import { VaultWorkloadHttpRoutes } from "./workload-http.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import { ProviderInstanceId } from "@t3tools/contracts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { VaultSshToolkit, vaultSshHandlers } from "./ssh-mcp.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as SshTransport from "./SshTransport.ts";
import { sshFixture } from "./VaultSsh.testkit.ts";
const backend = Layer.sync(OpenBaoStore.OpenBaoStore, () => {
  const records = new Map<string, { value: Redacted.Redacted<unknown>; version: number }>();
  return OpenBaoStore.OpenBaoStore.of({
    status: Effect.succeed({
      backend: "openbao",
      state: "ready",
      origin: "https://vault.example.test",
    }),
    read: (key) => Effect.sync(() => records.get(key) ?? null),
    write: (key, value, expectedVersion) =>
      Effect.suspend(() => {
        const version = records.get(key)?.version ?? 0;
        if (version !== expectedVersion) return Effect.fail(new VaultError({ reason: "conflict" }));
        records.set(key, { value, version: version + 1 });
        return Effect.succeed(version + 1);
      }),
    keys: (prefix) =>
      Effect.sync(() =>
        [...records.keys()]
          .filter((key) => key.startsWith(prefix + "/"))
          .map((key) => key.slice(prefix.length + 1)),
      ),
  });
});
const dependencies = Layer.merge(NodeServices.layer, backend);
const transport = Layer.succeed(SshTransport.SshTransport, {
  execute: (input) => input.authorize.pipe(Effect.as({ exitCode: 0, stdout: "ok" })),
});
const setup = Effect.gen(function* () {
  const f = yield* sshFixture(transport),
    host = yield* f.sshKeys.create;
  const input = {
    id: f.itemId,
    operationId: yield* f.id,
    label: "Development SSH",
    target: { hostname: "example.test", username: "git", port: 22, hostKey: host.publicKey },
  };
  const key = yield* f.ssh.generate(input, "admin", Effect.void);
  yield* f.grant(key.destination);
  return { ...f, input, key, session: yield* f.session(key.destination) };
});
const command = { expectedVersion: 1, argv: ["/usr/bin/printf", "ok"], timeoutMs: 8000 };
it.effect(
  "generates idempotent encrypted records, returns public metadata and rejects conflicting creation and trust revisions",
  () =>
    Effect.gen(function* () {
      const f = yield* setup;
      expect(yield* f.ssh.generate(f.input, "admin", Effect.void)).toEqual(f.key);
      expect(
        (yield* f.ssh
          .generate({ ...f.input, operationId: yield* f.id }, "admin", Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect((yield* f.ssh.info(f.itemId)).fingerprint).toBe(f.key.fingerprint);
      expect(JSON.stringify(f.key)).not.toContain("PRIVATE KEY");
      const replacement = yield* f.sshKeys.create;
      const change = {
        id: f.itemId,
        operationId: yield* f.id,
        expectedVersion: 1,
        hostKey: replacement.publicKey,
      };
      const updated = yield* f.ssh.trust(change, "admin", Effect.void);
      expect(updated.publicKey).toBe(f.key.publicKey);
      expect(updated.hostFingerprint).not.toBe(f.key.hostFingerprint);
      expect(yield* f.ssh.trust(change, "admin", Effect.void)).toEqual(updated);
      expect(
        (yield* f.ssh
          .trust({ ...change, operationId: yield* f.id }, "admin", Effect.void)
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* f.ssh
          .execute({ proof: yield* f.proof(f.session, command), command })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-operation");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "binds the complete command, timeout and key version, consumes proofs once and blocks archived keys",
  () =>
    Effect.gen(function* () {
      const f = yield* setup,
        proof = yield* f.proof(f.session, command);
      expect(
        (yield* f.ssh
          .execute({ proof, command: { ...command, argv: ["different"] } })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-proof");
      expect((yield* f.ssh.execute({ proof, command })).stdout).toBe("ok");
      expect((yield* f.ssh.execute({ proof, command }).pipe(Effect.flip)).reason).toBe(
        "invalid-proof",
      );
      const pending = yield* f.proof(f.session, command);
      yield* f.core.change(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
      );
      expect((yield* f.ssh.execute({ proof: pending, command }).pipe(Effect.flip)).reason).toBe(
        "denied",
      );
      yield* f.core.change(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 2, action: "restore" },
        "admin",
      );
      const current = { ...command, expectedVersion: 3 };
      expect(
        (yield* f.ssh.execute({ proof: yield* f.proof(f.session, current), command: current }))
          .exitCode,
      ).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect("rejects a grant revoked after proof issuance and a host disabled before execution", () =>
  Effect.gen(function* () {
    const f = yield* setup,
      pending = yield* f.proof(f.session, command);
    yield* f.access.apply(
      {
        operationId: yield* f.id,
        expectedRevision: 1,
        change: { type: "state", id: f.grantId, state: "suspended" },
      },
      "admin",
    );
    expect((yield* f.ssh.execute({ proof: pending, command }).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
    yield* f.access.apply(
      {
        operationId: yield* f.id,
        expectedRevision: 2,
        change: { type: "state", id: f.grantId, state: "active" },
      },
      "admin",
    );
    const next = yield* f.proof(f.session, command),
      registry = yield* f.brokers.snapshot;
    yield* f.brokers.apply(
      {
        operationId: yield* f.id,
        expectedRevision: registry.revision,
        change: { type: "disable", machineId: f.machineId },
      },
      "admin",
    );
    expect((yield* f.ssh.execute({ proof: next, command }).pipe(Effect.flip)).reason).toBe(
      "denied",
    );
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "rechecks current policy at the transport signing boundary and rejects permission reductions",
  () =>
    Effect.gen(function* () {
      let reduce = () => {};
      const f = yield* sshFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            Effect.sync(reduce).pipe(
              Effect.andThen(input.authorize),
              Effect.as({ exitCode: 0, stdout: "ok" }),
            ),
        }),
      );
      const host = yield* f.sshKeys.create,
        key = yield* f.ssh.generate(
          {
            id: f.itemId,
            operationId: yield* f.id,
            label: "SSH",
            target: {
              hostname: "example.test",
              username: "git",
              port: 22,
              hostKey: host.publicKey,
            },
          },
          "admin",
          Effect.void,
        );
      yield* f.grant(key.destination);
      const session = yield* f.session(key.destination),
        proof = yield* f.proof(session, command);
      reduce = () => {
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      };
      expect((yield* f.ssh.execute({ proof, command }).pipe(Effect.flip)).reason).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "requires human administration for key generation and trust while respecting thread inspection grants",
  () =>
    Effect.gen(function* () {
      const f = yield* setup;
      const toolkit = yield* VaultSshToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultSshHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, f.context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const scope: McpInvocationScope = {
        environmentId: f.environmentId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "ssh",
        thread: {
          threadId: f.threadId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: "session",
        },
        client: undefined,
      };
      const invoke = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_ssh_generate", f.input)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(f.context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* invoke(scope).pipe(Effect.flip))._tag).toBe("VaultError");
      const trust = yield* toolkit
        .handle("loom_vault_ssh_trust", {
          id: f.itemId,
          operationId: yield* f.id,
          expectedVersion: 1,
          hostKey: null,
        })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provide(f.context),
          Effect.provideService(McpInvocationContext, scope),
          Effect.flip,
        );
      expect(trust._tag).toBe("VaultError");
      const probe = yield* toolkit
        .handle("loom_vault_ssh_probe", { id: f.itemId, expectedVersion: 1 })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provide(f.context),
          Effect.provideService(McpInvocationContext, scope),
          Effect.flip,
        );
      expect(probe._tag).toBe("VaultError");
      expect(
        (yield* invoke({
          ...scope,
          thread: undefined,
          client: { sessionId: "read-only", label: "Read only", access: "read-only" },
        }).pipe(Effect.flip))._tag,
      ).toBe("OrchestratorMcpFailure");
      const human = {
        ...scope,
        thread: undefined,
        client: { sessionId: "admin", label: "Admin", access: "full-access" as const },
      };
      expect((yield* invoke(human))[0]?.result).toMatchObject({ publicKey: f.key.publicKey });
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: {
            type: "save",
            grant: {
              id: yield* f.id,
              label: "Inspect public SSH metadata",
              principal: { kind: "thread", id: f.threadId },
              itemIds: [f.itemId],
              actions: ["inspect"],
              projectId: null,
              destination: null,
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "admin",
      );
      const info = yield* toolkit
        .handle("loom_vault_ssh_info", { id: f.itemId })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provide(f.context),
          Effect.provideService(McpInvocationContext, scope),
        );
      expect(info[0]?.result).toMatchObject({ publicKey: f.key.publicKey });
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.live(
  "executes through the signed runner/HTTP boundary without admin tokens and rejects changed response bindings",
  () =>
    Effect.gen(function* () {
      const f = yield* setup;
      const web = HttpRouter.toWebHandler(
        VaultWorkloadHttpRoutes.pipe(
          Layer.provide(Layer.succeed(ForkRuntime, f.context as Context.Context<ForkServices>)),
          HttpRouter.provideRequest(NodeHttpPlatform.layer),
        ),
        { disableLogger: true },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      let tamper = false;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        expect(request.headers.has("authorization")).toBe(false);
        const response = await web.handler(request);
        if (tamper && request.url.endsWith("/ssh-exec") && response.status === 200) {
          await response.arrayBuffer();
          return Response.json({
            sessionId: "0".repeat(32),
            requestId: "1".repeat(32),
            exitCode: 0,
            stdout: "ok",
          });
        }
        return response;
      };
      const identities = Layer.mock(BrokerIdentity.BrokerIdentity)({
        read: (directory) =>
          Effect.succeed({
            ...(directory === "machine" ? f.machine : f.workload),
            protocol: 1 as const,
            directory,
            platform: "linux" as const,
          }),
        connection: () =>
          Effect.succeed({
            protocol: 1 as const,
            origin: "http://127.0.0.1:12345",
            environmentId: f.environmentId,
            machineId: f.machineId,
          }),
        invitation: (file) => Effect.succeed(file === "session" ? f.session : command),
      });
      const clientLayer = BrokerHttpClient.layer.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
      );
      const runner = yield* WorkloadRunner.WorkloadRunner.pipe(
        Effect.provide(
          WorkloadRunner.layer.pipe(
            Layer.provide(Layer.mergeAll(identities, clientLayer, Layer.succeedContext(f.context))),
          ),
        ),
      );
      expect((yield* runner.ssh("machine", "workload", "session", "command")).stdout).toBe("ok");
      tamper = true;
      expect(
        (yield* runner.ssh("machine", "workload", "session", "command").pipe(Effect.flip)).reason,
      ).toBe("invalid-proof");
      tamper = false;
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: { type: "state", id: f.grantId, state: "revoked" },
        },
        "admin",
      );
      expect(
        (yield* runner.ssh("machine", "workload", "session", "command").pipe(Effect.flip)).reason,
      ).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect("removes and restores host trust without replacing the dedicated key", () =>
  Effect.gen(function* () {
    const f = yield* setup;
    const removed = yield* f.ssh.trust(
      { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, hostKey: null },
      "admin",
      Effect.void,
    );
    expect(removed.target.hostKey).toBeNull();
    expect(removed.hostFingerprint).toBeNull();
    expect(removed.publicKey).toBe(f.key.publicKey);
    const current = { ...command, expectedVersion: 2 };
    expect(
      (yield* f.ssh
        .execute({ proof: yield* f.proof(f.session, current), command: current })
        .pipe(Effect.flip)).reason,
    ).toBe("untrusted-host");
    expect(
      (yield* f.ssh.trust(
        {
          id: f.itemId,
          operationId: yield* f.id,
          expectedVersion: 2,
          hostKey: f.input.target.hostKey,
        },
        "admin",
        Effect.void,
      )).hostFingerprint,
    ).toBe(f.key.hostFingerprint);
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "bounds concurrent operations and returns the permit when an execution is cancelled",
  () =>
    Effect.gen(function* () {
      const entered = yield* Effect.forEach([0, 1, 2, 3, 4], () => Deferred.make<void>()),
        release = yield* Deferred.make<{ exitCode: number; stdout: string }>();
      let starts = 0;
      const f = yield* sshFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            Effect.gen(function* () {
              yield* input.authorize;
              yield* Deferred.succeed(entered[starts++]!, undefined);
              return yield* Deferred.await(release);
            }),
        }),
      );
      const host = yield* f.sshKeys.create,
        key = yield* f.ssh.generate(
          {
            id: f.itemId,
            operationId: yield* f.id,
            label: "SSH",
            target: {
              hostname: "example.test",
              username: "git",
              port: 22,
              hostKey: host.publicKey,
            },
          },
          "admin",
          Effect.void,
        );
      yield* f.grant(key.destination);
      const session = yield* f.session(key.destination);
      const fibers = [];
      for (let index = 0; index < 4; index++) {
        const proof = yield* f.proof(session, command);
        fibers.push(yield* f.ssh.execute({ proof, command }).pipe(Effect.forkChild));
        yield* Deferred.await(entered[index]!);
      }
      // Four consumed challenges are retained until expiry, so use a fresh bounded session.
      const another = yield* f.session(key.destination);
      expect(
        (yield* f.ssh
          .execute({ proof: yield* f.proof(another, command), command })
          .pipe(Effect.flip)).reason,
      ).toBe("capacity");
      yield* Fiber.interrupt(fibers[0]!);
      const next = yield* f.ssh
        .execute({ proof: yield* f.proof(another, command), command })
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered[4]!);
      yield* Deferred.succeed(release, { exitCode: 0, stdout: "ok" });
      expect((yield* Fiber.join(next)).stdout).toBe("ok");
      for (const fiber of fibers.slice(1)) yield* Fiber.join(fiber);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "runs only a fixed administrator probe, returns safe evidence and rejects stale or untrusted keys",
  () =>
    Effect.gen(function* () {
      let observed: readonly string[] = [];
      const f = yield* sshFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  observed = input.command.argv;
                }),
              ),
              Effect.as({ exitCode: 0, stdout: "remote output stays private" }),
            ),
        }),
      );
      const host = yield* f.sshKeys.create,
        key = yield* f.ssh.generate(
          {
            id: f.itemId,
            operationId: yield* f.id,
            label: "SSH",
            target: {
              hostname: "example.test",
              username: "git",
              port: 22,
              hostKey: host.publicKey,
            },
          },
          "admin",
          Effect.void,
        );
      const input = { id: f.itemId, expectedVersion: 1 };
      expect(
        (yield* f.ssh
          .probe(input, Effect.fail(new VaultError({ reason: "denied" })))
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      const result = yield* f.ssh.probe(input, Effect.void);
      expect(observed).toEqual(["/usr/bin/true"]);
      expect(result).toMatchObject({
        id: f.itemId,
        version: 1,
        destination: key.destination,
        authenticated: true,
      });
      expect(result).not.toHaveProperty("stdout");
      yield* f.ssh.trust(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, hostKey: null },
        "admin",
        Effect.void,
      );
      expect((yield* f.ssh.probe(input, Effect.void).pipe(Effect.flip)).reason).toBe("conflict");
      expect(
        (yield* f.ssh.probe({ ...input, expectedVersion: 2 }, Effect.void).pipe(Effect.flip))
          .reason,
      ).toBe("untrusted-host");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect("rechecks administrator authorization at the transport boundary before probing", () =>
  Effect.gen(function* () {
    let allowed = true;
    const f = yield* sshFixture(
      Layer.succeed(SshTransport.SshTransport, {
        execute: (input) =>
          Effect.sync(() => {
            allowed = false;
          }).pipe(Effect.andThen(input.authorize), Effect.as({ exitCode: 0, stdout: "" })),
      }),
    );
    const host = yield* f.sshKeys.create;
    yield* f.ssh.generate(
      {
        id: f.itemId,
        operationId: yield* f.id,
        label: "SSH",
        target: { hostname: "example.test", username: "git", port: 22, hostKey: host.publicKey },
      },
      "admin",
      Effect.void,
    );
    const authorize = Effect.suspend(() =>
      allowed ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
    );
    expect(
      (yield* f.ssh.probe({ id: f.itemId, expectedVersion: 1 }, authorize).pipe(Effect.flip))
        .reason,
    ).toBe("denied");
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
