// @effect-diagnostics nodeBuiltinImport:off -- Independent wire fixtures verify the actual host-bound signature with public keys.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { RunId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { vaultGitDestination, VaultSshAgentSession } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SshCrypto from "./SshCrypto.ts";
import * as SshTransport from "./SshTransport.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
import { VaultSshToolkit, vaultSshHandlers } from "./ssh-mcp.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";

const decodeAgentSession = Schema.decodeUnknownSync(VaultSshAgentSession);
const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const fixture = Effect.gen(function* () {
  const f = yield* launchFixture(Layer.mock(SshTransport.SshTransport)({}));
  yield* f.grant(f.key.destination);
  const activation = yield* f.launch.agent({ id: f.itemId, expectedVersion: 1 }, f.threadId);
  const channelId = yield* f.id;
  const host = Buffer.from(f.host.publicKey.split(" ")[1]!, "base64"),
    key = Buffer.from(f.key.publicKey.split(" ")[1]!, "base64"),
    session = Buffer.alloc(32, 41);
  const bind = Buffer.concat([
    Buffer.from([27]),
    SshCrypto.sshString("session-bind@openssh.com"),
    SshCrypto.sshString(host),
    SshCrypto.sshString(session),
    SshCrypto.sshString(
      Buffer.concat([
        SshCrypto.sshString("ssh-ed25519"),
        SshCrypto.sshString(
          NodeCrypto.sign(
            null,
            session,
            NodeCrypto.createPrivateKey(Redacted.value(f.host.privateKey)),
          ),
        ),
      ]),
    ),
    Buffer.from([0]),
  ]);
  const data = Buffer.concat([
    SshCrypto.sshString(session),
    Buffer.from([50]),
    SshCrypto.sshString(f.key.target.username),
    SshCrypto.sshString("ssh-connection"),
    SshCrypto.sshString("publickey-hostbound-v00@openssh.com"),
    Buffer.from([1]),
    SshCrypto.sshString("ssh-ed25519"),
    SshCrypto.sshString(key),
    SshCrypto.sshString(host),
  ]);
  const sign = Buffer.concat([
    Buffer.from([13]),
    SshCrypto.sshString(key),
    SshCrypto.sshString(data),
    SshCrypto.sshUint32(0),
  ]);
  const frame = (sequence: number, payload: Buffer, channel = channelId, threadId = f.threadId) =>
    f.ssh.agentFrame(
      {
        sessionId: activation.sessionId,
        channelId: channel,
        sequence,
        frame: payload.toString("base64"),
      },
      threadId,
    );
  return { ...f, activation, bind, data, sign, frame };
});
it.effect(
  "opens a proved run-owned session, lists one identity and signs only its pinned host-bound authentication",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(yield* f.workloads.list(f.threadId)).toHaveLength(1);
      expect(yield* f.ssh.agents(f.threadId)).toEqual([f.activation]);
      expect(JSON.stringify(f.activation)).not.toContain("privateKey");
      const identities = Buffer.from((yield* f.frame(0, Buffer.from([11]))).response, "base64");
      expect(identities[0]).toBe(12);
      yield* f.frame(1, f.bind);
      const response = new SshCrypto.SshReader(
        Buffer.from((yield* f.frame(2, f.sign)).response, "base64"),
      );
      expect(response.byte()).toBe(14);
      const signature = new SshCrypto.SshReader(response.string());
      expect(signature.string().toString()).toBe("ssh-ed25519");
      const publicBlob = new SshCrypto.SshReader(
        Buffer.from(f.key.publicKey.split(" ")[1]!, "base64"),
      );
      publicBlob.string();
      const publicObject = NodeCrypto.createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBlob.string()]),
        type: "spki",
        format: "der",
      });
      expect(NodeCrypto.verify(null, f.data, publicObject, signature.string())).toBe(true);
      expect((yield* f.frame(3, f.sign).pipe(Effect.flip)).reason).toBe("invalid-operation");
      yield* f.ssh.agentClose(f.activation.sessionId, f.threadId);
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      expect((yield* f.frame(4, Buffer.from([11])).pipe(Effect.flip)).reason).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect.each(["revoked", "run", "mode", "archived", "host", "version", "closed"] as const)(
  "rechecks %s before issuing a signature",
  (change) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.frame(0, f.bind);
      if (change === "revoked")
        yield* f.access.apply(
          {
            operationId: yield* f.id,
            expectedRevision: 1,
            change: { type: "state", id: f.grantId, state: "revoked" },
          },
          "admin",
        );
      if (change === "run")
        f.state.thread = { ...f.state.thread, activeRunId: RunId.make("other-run") };
      if (change === "mode")
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
      if (change === "archived")
        yield* f.core.change(
          { id: f.itemId, expectedVersion: 1, operationId: yield* f.id, action: "archive" },
          "admin",
          Effect.void,
        );
      if (change === "host")
        yield* f.brokers.apply(
          {
            operationId: yield* f.id,
            expectedRevision: 3,
            change: { type: "disable", machineId: f.machineId },
          },
          "admin",
        );
      if (change === "version")
        yield* f.ssh.trust(
          { id: f.itemId, expectedVersion: 1, operationId: yield* f.id, hostKey: null },
          "admin",
          Effect.void,
        );
      if (change === "closed") yield* f.ssh.agentClose(f.activation.sessionId, f.threadId);
      const error = yield* f.frame(1, f.sign).pipe(Effect.flip);
      expect(["denied", "conflict"]).toContain(error.reason);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "rejects foreign callers, replay, generic signing, forwarding and expired activations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        (yield* f.frame(0, f.bind, yield* f.id, ThreadId.make("other")).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f.ssh.agentClose(f.activation.sessionId, ThreadId.make("other")).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
      const forwarded = Buffer.from(f.bind);
      forwarded[forwarded.length - 1] = 1;
      expect((yield* f.frame(0, forwarded).pipe(Effect.flip)).reason).toBe("invalid-key");
      expect((yield* f.frame(0, f.bind).pipe(Effect.flip)).reason).toBe("invalid-operation");
      expect((yield* f.frame(1, Buffer.from([13])).pipe(Effect.flip)).reason).toBe("invalid-key");
      yield* TestClock.adjust(300_000);
      expect((yield* f.frame(2, f.bind).pipe(Effect.flip)).reason).toBe("expired");
      expect(yield* f.ssh.agents(f.threadId)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "repository-only Git grants cannot open a general host agent and failed activation releases its workload",
  () =>
    Effect.gen(function* () {
      const f = yield* launchFixture(Layer.mock(SshTransport.SshTransport)({}));
      yield* f.grant(vaultGitDestination(f.key.target, "team/repo.git"));
      expect(
        (yield* f.launch.agent({ id: f.itemId, expectedVersion: 1 }, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "authenticated MCP can activate, inspect and close; administrator and mismatched-provider callers cannot",
  () =>
    Effect.gen(function* () {
      const f = yield* launchFixture(Layer.mock(SshTransport.SshTransport)({}));
      yield* f.grant(f.key.destination);
      const context = Context.add(f.context, VaultLaunch.VaultLaunch, f.launch);
      const toolkit = yield* VaultSshToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultSshHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const scope: McpInvocationScope = {
        environmentId: f.environmentId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "agent-test",
        client: undefined,
        thread: {
          threadId: f.threadId,
          providerInstanceId: f.state.thread.providerInstanceId,
          providerSessionId: "synthetic",
        },
      };
      const invoke = (caller: McpInvocationScope) =>
        toolkit
          .handle("loom_vault_ssh_agent_open", { id: f.itemId, expectedVersion: 1 })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(f.context),
            Effect.provideService(McpInvocationContext, caller),
          );
      const result = decodeAgentSession((yield* invoke(scope))[0]!.result);
      expect(result.id).toBe(f.itemId);
      expect(
        (yield* invoke({
          ...scope,
          thread: undefined,
          client: { sessionId: "admin", access: "full-access", label: "Administrator" },
        }))[0],
      ).toMatchObject({
        isFailure: true,
        result: { _tag: "VaultError", reason: "denied" },
      });
      expect(
        (yield* invoke({
          ...scope,
          thread: { ...scope.thread!, providerInstanceId: ProviderInstanceId.make("wrong") },
        }))[0],
      ).toMatchObject({
        isFailure: true,
        result: { _tag: "OrchestratorMcpFailure", code: "parent_not_active" },
      });
      expect((yield* f.ssh.agents(f.threadId)).map((agent) => agent.sessionId)).toEqual([
        result.sessionId,
      ]);
      yield* f.ssh.agentClose(result.sessionId, f.threadId);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
