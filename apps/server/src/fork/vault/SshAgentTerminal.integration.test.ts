// @effect-diagnostics nodeBuiltinImport:off -- Disposable OpenBao/OpenSSH and a synthetic authenticated MCP endpoint verify real CLI subprocesses.
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  VaultError,
  VaultSshAgentOpen,
  VaultSshAgentFrame,
  VaultSshAgentClose,
  type VaultSshAgentRun,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as OpenBaoStore from "./OpenBaoStore.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import { sshFixture } from "./VaultSsh.testkit.ts";

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
const decodeOpen = Schema.decodeUnknownEffect(VaultSshAgentOpen),
  decodeFrame = Schema.decodeUnknownEffect(VaultSshAgentFrame),
  decodeClose = Schema.decodeUnknownEffect(VaultSshAgentClose);
const decodeRequest = Schema.decodeUnknownEffect(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Unknown),
    method: Schema.String,
    params: Schema.optionalKey(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        arguments: Schema.optionalKey(Schema.Unknown),
      }),
    ),
  }),
);
const fixture = Effect.gen(function* () {
  const f = yield* sshFixture();
  const target = {
    hostname: "127.0.0.1",
    username: process.env.LOOM_VAULT_TEST_SSH_USER!,
    port: Number(process.env.LOOM_VAULT_TEST_SSH_PORT),
    hostKey: process.env.LOOM_VAULT_TEST_SSH_HOST_KEY!,
  };
  const key = yield* f.ssh.generate(
    { id: f.itemId, operationId: yield* f.id, label: "Disposable terminal key", target },
    "fixture-admin",
    Effect.void,
  );
  yield* Effect.promise(() =>
    NodeFSP.writeFile(process.env.LOOM_VAULT_TEST_SSH_AUTHORIZED_KEYS!, key.publicKey + "\n", {
      mode: 0o600,
    }),
  );
  yield* f.grant(key.destination);
  const identity = BrokerIdentity.BrokerIdentity.of({
    read: () =>
      Effect.succeed({
        protocol: 1,
        ...f.machine,
        platform: "darwin",
        directory: "/private/synthetic-broker",
      }),
    connection: () =>
      Effect.succeed({
        protocol: 1,
        origin: "http://localhost:1",
        environmentId: f.environmentId,
        machineId: f.machineId,
      }),
    connect: () => Effect.void,
    invitation: () => Effect.succeed(null),
  });
  const launch = yield* VaultLaunch.VaultLaunch.pipe(
    Effect.provide(VaultLaunch.layer.pipe(Layer.provide(Layer.succeedContext(f.context)))),
    Effect.provideService(BrokerIdentity.BrokerIdentity, identity),
    Effect.provideService(HostProcess.Environment, {
      LOOM_VAULT_EXECUTION_BROKER_DIR: "/private/synthetic-broker",
    }),
  );
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp("/private/tmp/loom-agent-cli-proof-")),
    (p) => Effect.promise(() => NodeFSP.rm(p, { recursive: true, force: true })),
  );
  const control = { revokeOnSign: false, frames: 0 };
  const http = yield* NodeHttpServer.make(() => NodeHttp.createServer(), {
    host: "127.0.0.1",
    port: 0,
  });
  yield* http.serve(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers.authorization !== "Bearer synthetic-agent-proof")
        return HttpServerResponse.empty({ status: 401 });
      const message = yield* decodeRequest(yield* request.json);
      if (message.method === "notifications/initialized")
        return HttpServerResponse.empty({ status: 202 });
      let result: unknown = {
        protocolVersion: "2025-06-18",
        capabilities: {},
        serverInfo: { name: "Loom disposable SSH proof", version: "1" },
      };
      if (message.method === "tools/call") {
        const operation = Effect.gen(function* () {
          if (message.params?.name === "loom_vault_ssh_agent_open")
            return yield* launch.agent(yield* decodeOpen(message.params.arguments), f.threadId);
          if (message.params?.name === "loom_vault_ssh_agent_frame") {
            const frame = yield* decodeFrame(message.params.arguments);
            control.frames++;
            if (control.revokeOnSign && Buffer.from(frame.frame, "base64")[0] === 13) {
              control.revokeOnSign = false;
              yield* f.access.apply(
                {
                  operationId: yield* f.id,
                  expectedRevision: 1,
                  change: { type: "state", id: f.grantId, state: "revoked" },
                },
                "fixture-admin",
              );
            }
            return yield* f.ssh.agentFrame(frame, f.threadId);
          }
          if (message.params?.name === "loom_vault_ssh_agent_close")
            return yield* f.ssh.agentClose(
              (yield* decodeClose(message.params.arguments)).sessionId,
              f.threadId,
            );
          return yield* new VaultError({ reason: "denied" });
        });
        const outcome = yield* operation.pipe(Effect.result);
        result =
          outcome._tag === "Success"
            ? { structuredContent: outcome.success }
            : { isError: true, content: [{ type: "text", text: "Synthetic operation denied" }] };
      }
      return HttpServerResponse.jsonUnsafe(
        { jsonrpc: "2.0", id: message.id, result },
        { headers: { "mcp-session-id": "synthetic-agent" } },
      );
    }),
  );
  const address = http.address;
  if (!("port" in address)) return yield* Effect.die("Missing fixture port");
  const entrypoint = NodePath.resolve("apps/server/src/bin.ts");
  const execute = (command: VaultSshAgentRun["command"], timeoutMs = 30000, pi = false) =>
    Effect.tryPromise(
      () =>
        new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
          const env: NodeJS.ProcessEnv = {
            PATH: "/usr/bin:/bin",
            HOME: root,
            TMPDIR: "/private/tmp",
            NO_COLOR: "1",
            SSH_AUTH_SOCK: "/synthetic-personal-agent",
            GIT_SSH_COMMAND: "synthetic-personal-ssh",
            ...(pi
              ? {
                  T3_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
                  T3_MCP_BEARER_TOKEN: "synthetic-agent-proof",
                }
              : {
                  LOOM_MCP_ENDPOINT: `http://127.0.0.1:${address.port}/mcp`,
                  LOOM_MCP_AUTHORIZATION: "Bearer synthetic-agent-proof",
                }),
          };
          const child = NodeChildProcess.spawn(
            NodeProcess.execPath,
            [
              entrypoint,
              "vault",
              "ssh-agent-exec",
              JSON.stringify({ id: f.itemId, expectedVersion: 1, command, timeoutMs }),
            ],
            { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
          );
          let stdout = "",
            stderr = "";
          child.stdout.on("data", (b) => {
            stdout += b;
          });
          child.stderr.on("data", (b) => {
            stderr += b;
          });
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stdout, stderr }));
        }),
    );
  return { ...f, root, key, target, control, execute };
});
it.live.skipIf(!configured)(
  "real CLI SSH and Git clone/fetch/push use a remote signing agent, retain exact streams/exits and clean every activation",
  () =>
    Effect.gen(function* () {
      const before = new Set(yield* Effect.promise(() => NodeFSP.readdir("/private/tmp")));
      const f = yield* fixture;
      const result = yield* f.execute(
        {
          tool: "ssh",
          argv: [
            `${f.target.username}@127.0.0.1`,
            "printf 'Loom terminal output\\n'; printf 'terminal stderr\\n' >&2; exit 7",
          ],
        },
        30000,
        true,
      );
      expect(result).toEqual({
        code: 7,
        stdout: "Loom terminal output\n",
        stderr: "terminal stderr\n",
      });
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      const remote = process.env.LOOM_VAULT_TEST_GIT_REMOTE!,
        checkout = NodePath.join(f.root, "cloned");
      const clone = yield* f.execute({
        tool: "git",
        argv: ["clone", `ssh://${f.target.username}@127.0.0.1:${f.target.port}${remote}`, checkout],
      });
      expect(clone.code, clone.stderr).toBe(0);
      expect(
        yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(checkout, "README"), "utf8")),
      ).toBe("Disposable Vault Git proof\n");
      const fetch = yield* f.execute({ tool: "git", argv: ["-C", checkout, "fetch", "origin"] });
      expect(fetch.code, fetch.stderr).toBe(0);
      const push = yield* f.execute({
        tool: "git",
        argv: ["-C", checkout, "push", "origin", "HEAD:refs/heads/terminal-proof"],
      });
      expect(push.code).toBe(0);
      expect(f.control.frames).toBeGreaterThan(4);
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      const after = yield* Effect.promise(() =>
        NodeFSP.readdir("/private/tmp", { withFileTypes: true }),
      );
      expect(
        after.filter(
          (p) => p.isDirectory() && p.name.startsWith("loom-vault-agent-") && !before.has(p.name),
        ),
      ).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  60000,
);
it.live.skipIf(!configured)(
  "real terminal authentication stops when a grant is revoked before signing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      f.control.revokeOnSign = true;
      const result = yield* f.execute({
        tool: "ssh",
        argv: [f.target.hostname, "printf should-not-authenticate"],
      });
      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toContain("should-not-authenticate");
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  30000,
);
