import * as VaultLaunch from "./VaultLaunch.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultSshGenerate,
  VaultSshRun,
  VaultSshResult,
  VaultGitRun,
  VaultGitResult,
  VaultSshProbe,
  VaultSshProbeResult,
  VaultSshTrust,
  VaultSshInfo,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultAccess from "./VaultAccess.ts";
const failure = Schema.Union([
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  OrchestratorMcpFailure,
]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultSshToolkit = Toolkit.make(
  Tool.make("loom_vault_ssh_exec", {
    description:
      "Run bounded SSH argv using a dedicated Vault item and its current version for this authenticated active thread/run. Automatically signs and releases an operation-scoped workload through the server's enrolled broker. Requires a current exact-destination use grant and full-access/default mode. No private keys, manual session files or personal key-manager prompts. Execution is on the Loom server, not the provider's terminal. Do not put secrets in argv or output. No retry after unknown outcomes.",
    parameters: VaultSshRun,
    success: VaultSshResult,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_git", {
    description:
      "List remote refs or fetch into this thread's checkout using a dedicated Vault SSH key. Supply item id, current expectedVersion, action ls-remote or fetch, repository path on that host and timeoutMs up to 30000. Destination grant is git+ssh://user@host:port/repository (absolute paths use /:absolute/path). Host-scoped SSH grants alone do not grant this Git destination. Workload signing/release is automatic through the configured enrolled server broker. Fetch writes FETCH_HEAD, does not merge, rewrite origin or change personal SSH settings. No clone/push/submodules yet. Runs on the Loom server; no secret output.",
    parameters: VaultGitRun,
    success: VaultGitResult,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_ssh_probe", {
    description:
      "Test one pinned SSH destination from the Loom server with a fixed /usr/bin/true command and current key version. Human full-access administrator clients only. Does not configure provider/Git access or grant an agent credential use.",
    parameters: VaultSshProbe,
    success: VaultSshProbeResult,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_ssh_generate", {
    description:
      "Generate a dedicated Ed25519 SSH key in OpenBao, bound to one explicit user/host/port and independently verified Ed25519 host public key, or null to leave the destination untrusted. Return only public metadata. Full-access administrator clients only; threads cannot generate or approve host trust. Retain id/operationId for retries. Does not register the public key on a host.",
    parameters: VaultSshGenerate,
    success: VaultSshInfo,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_ssh_info", {
    description:
      "Read a managed SSH key's public key, destination and fingerprints. Threads require an inspect grant; administrator clients may inspect. No private key is returned.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultSshInfo,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_ssh_trust", {
    description:
      "Replace the pinned Ed25519 host public key after independent verification, or set hostKey:null to remove trust as a full-access administrator client. Requires the current item version and an operation ID. Existing signed operations with the older key version fail. Threads cannot approve changed host keys.",
    parameters: VaultSshTrust,
    success: VaultSshInfo,
    failure,
    dependencies,
  }),
);
export const vaultSshHandlers = McpToolAccess.toLayer(
  VaultSshToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const administrator = Effect.gen(function* () {
      const caller = yield* McpInvocationContext;
      if (caller.thread || caller.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied" });
      return `client:${caller.client.sessionId}`;
    });
    const callingThread = Effect.gen(function* () {
      const caller = yield* McpInvocationContext;
      if (!caller.thread) return yield* new VaultError({ reason: "denied" });
      return caller.thread.threadId;
    });
    return {
      loom_vault_ssh_exec: McpToolAccess.writesEnvironment((input) =>
        callingThread.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultLaunch.VaultLaunch, (launch) => launch.ssh(input, threadId)),
            ),
          ),
        ),
      ),
      loom_vault_git: McpToolAccess.writesEnvironment((input) =>
        callingThread.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultLaunch.VaultLaunch, (launch) => launch.git(input, threadId)),
            ),
          ),
        ),
      ),
      loom_vault_ssh_probe: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          yield* administrator;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultSsh.VaultSsh, (service) => service.probe(input, authorize)),
          );
        }),
      ),
      loom_vault_ssh_info: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (!caller.thread && caller.client?.access !== "full-access")
            return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.gen(function* () {
              if (caller.thread)
                yield* Effect.flatMap(VaultAccess.VaultAccess, (access) =>
                  access.require(caller.thread!.threadId, input.id, "inspect", null),
                );
              return yield* Effect.flatMap(VaultSsh.VaultSsh, (service) => service.info(input.id));
            }),
          );
        }),
      ),
      loom_vault_ssh_generate: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const actor = yield* administrator;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultSsh.VaultSsh, (service) =>
              service.generate(input, actor, authorize),
            ),
          );
        }),
      ),
      loom_vault_ssh_trust: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const actor = yield* administrator;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultSsh.VaultSsh, (service) => service.trust(input, actor, authorize)),
          );
        }),
      ),
    };
  }),
);
