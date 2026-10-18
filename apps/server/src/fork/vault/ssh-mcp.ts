import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultSshGenerate,
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
    return {
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
