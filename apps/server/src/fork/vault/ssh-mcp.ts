import { objectInput } from "./mcp-input.ts";
import { withFailureMessages } from "./mcp-failure.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultSshAgentOpenInput,
  VaultConnectionError,
  VaultSshAgentSession,
  VaultSshAgentFrame,
  VaultSshAgentResponse,
  VaultSshAgentClose,
  VaultSshAgentClosed,
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultSshGenerate,
  VaultSshRunInput,
  VaultSshResult,
  VaultGitRunInput,
  VaultGitResult,
  VaultSshProbe,
  VaultSshProbeResult,
  VaultSshTrust,
  VaultSshInfo,
  VaultSshPinnedKeysInput,
  VaultSshPinnedKey,
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
const failure = withFailureMessages(
  Schema.Union([
    VaultError,
    VaultSshError,
    VaultWorkloadError,
    VaultConnectionError,
    OrchestratorMcpFailure,
  ]),
);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultSshToolkit = Toolkit.make(
  Tool.make("loom_vault_ssh_pinned_keys", {
    description:
      "Read matching Ed25519 host keys from this Loom computer's SSH configuration and known-hosts files. Human full-access administrator only. Returns fingerprints and global versus user file sources; it does not scan, trust or connect to the host. Review the fingerprint before using loom_vault_ssh_trust.",
    parameters: VaultSshPinnedKeysInput,
    success: Schema.Array(VaultSshPinnedKey),
    failure,
    failureMode: "return",
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_ssh_agent_open", {
    description:
      "Explicitly activate one five-minute SSH agent session for this current full-access/default run, dedicated key/version and pinned host. Requires current Vault policy permission for that SSH host; repository-only grants do not authorize agent signing. Use the Loom ssh-agent-exec CLI to run ordinary terminal SSH/Git with local socket cleanup. Returns public metadata, never private keys. Already authenticated remote connections are not recalled by revocation.",
    parameters: VaultSshAgentOpenInput.check(objectInput),
    success: VaultSshAgentSession,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_ssh_agent_frame", {
    description:
      "Relay one bounded SSH agent protocol frame for an owned activation/channel with strict sequence order. The server verifies session/host-bound authentication and current access policy before releasing a signature. Used by the Loom terminal agent; no generic signing or forwarding.",
    parameters: VaultSshAgentFrame,
    success: VaultSshAgentResponse,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_ssh_agent_close", {
    description:
      "Close an owned terminal SSH agent activation and its workload session. Prevents new signing; does not undo authenticated remote operations.",
    parameters: VaultSshAgentClose,
    success: VaultSshAgentClosed,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_ssh_agents", {
    description:
      "List public terminal-agent activations for this authenticated active run. References alone grant no signing access.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(VaultSshAgentSession),
    failure,
    failureMode: "return",
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_ssh_exec", {
    description:
      "Run a short SSH probe (at most 8 seconds and 2 KiB of output) using a dedicated Vault item and its current version for this authenticated active thread/run. For anything longer, file transfers or piped stdin, run `loom vault ssh-agent-exec` in the agent terminal with connection:{resource:personal-vps} and argv [\"personal-vps\", ...] instead. Automatically signs and releases an operation-scoped workload through the server's enrolled broker. Accepts connection:{resource:personal-vps} with command:{argv,timeoutMs}, or the existing explicit item/version. Requires current Vault policy and full-access/default mode. Owner-trusted environments need no individual grant or project profile. No private keys, manual session files or personal key-manager prompts. Execution is on the Loom server, not the provider's terminal. Do not put secrets in argv or output. No retry after unknown outcomes.",
    parameters: VaultSshRunInput.check(objectInput),
    success: VaultSshResult,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_git", {
    description:
      "List remote refs or fetch into this thread's checkout using a dedicated Vault SSH key. Supply connection:{resource} or an explicit item id/current expectedVersion, action ls-remote or fetch, repository path on that host and timeoutMs up to 30000. Requires current Vault policy permission; owner-trusted mode needs no individual grant. Restricted grants use git+ssh://user@host:port/repository (absolute paths use /:absolute/path); a host-scoped SSH grant alone does not authorize this Git destination. Workload signing/release is automatic through the configured enrolled server broker. Fetch writes FETCH_HEAD, does not merge, rewrite origin or change personal SSH settings. No clone/push/submodules yet. Runs on the Loom server; no secret output.",
    parameters: VaultGitRunInput.check(objectInput),
    success: VaultGitResult,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_ssh_probe", {
    description:
      "Test one pinned SSH destination from the Loom server with a fixed /usr/bin/true command and current key version. Human full-access administrator clients only. Does not configure provider/Git access or grant an agent credential use.",
    parameters: VaultSshProbe,
    success: VaultSshProbeResult,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_ssh_generate", {
    description:
      "Generate a dedicated Ed25519 SSH key in OpenBao, bound to one explicit user/host/port and independently verified Ed25519 host public key, or null to leave the destination untrusted. Return only public metadata. Full-access administrator clients only; threads cannot generate or approve host trust. Retain id/operationId for retries. Does not register the public key on a host.",
    parameters: VaultSshGenerate,
    success: VaultSshInfo,
    failure,
    failureMode: "return",
    dependencies,
  }),
  Tool.make("loom_vault_ssh_info", {
    description:
      "Read a managed SSH key's public key, destination and fingerprints. Threads require metadata inspection permission; administrator clients may inspect. No private key is returned.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultSshInfo,
    failure,
    failureMode: "return",
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_ssh_trust", {
    description:
      "Replace the pinned Ed25519 host public key after independent verification, or set hostKey:null to remove trust as a full-access administrator client. Requires the current item version and an operation ID. Existing signed operations with the older key version fail. Threads cannot approve changed host keys.",
    parameters: VaultSshTrust,
    success: VaultSshInfo,
    failure,
    failureMode: "return",
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
        return yield* new VaultError({ reason: "denied", detail: "admin-only" });
      return `client:${caller.client.sessionId}`;
    });
    const callingThread = Effect.gen(function* () {
      const caller = yield* McpInvocationContext;
      if (!caller.thread) return yield* new VaultError({ reason: "denied" });
      return caller.thread.threadId;
    });
    return {
      loom_vault_ssh_pinned_keys: McpToolAccess.reads((input) =>
        administrator.pipe(
          Effect.andThen(
            onHost(Effect.flatMap(VaultSsh.VaultSsh, (service) => service.pinnedKeys(input))),
          ),
        ),
      ),
      loom_vault_ssh_agent_open: McpToolAccess.writesEnvironment((input) =>
        callingThread.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultLaunch.VaultLaunch, (launch) => launch.agent(input, threadId)),
            ),
          ),
        ),
      ),
      loom_vault_ssh_agent_frame: McpToolAccess.writesEnvironment((input) =>
        callingThread.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultSsh.VaultSsh, (service) => service.agentFrame(input, threadId)),
            ),
          ),
        ),
      ),
      loom_vault_ssh_agent_close: McpToolAccess.writesEnvironment((input) =>
        callingThread.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultSsh.VaultSsh, (service) =>
                service.agentClose(input.sessionId, threadId),
              ),
            ),
          ),
        ),
      ),
      loom_vault_ssh_agents: McpToolAccess.reads(() =>
        callingThread.pipe(
          Effect.flatMap((threadId) =>
            onHost(Effect.flatMap(VaultSsh.VaultSsh, (service) => service.agents(threadId))),
          ),
        ),
      ),
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
