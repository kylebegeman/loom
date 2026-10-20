import { sshAgentExecCommand } from "./ssh-agent-cli.ts";
import { githubExecCommand } from "./terminal-cli.ts";
import { brokerCommand } from "./broker-cli.ts";
// @effect-diagnostics nodeBuiltinImport:off -- CLI process boundary reads its authenticated connection environment.
import * as NodeProcess from "node:process";
import { Argument, Command } from "effect/cli";
import { callForkTool } from "../cli/callTool.ts";
const actions = {
  health: "loom_vault_health",
  "health-apply": "loom_vault_health_apply",
  "health-recheck": "loom_vault_health_recheck",
  "terminal-readiness": "loom_vault_terminal_readiness",
  "ssh-agents": "loom_vault_ssh_agents",
  "ssh-agent-close": "loom_vault_ssh_agent_close",
  "references-search": "loom_vault_references_search",
  "references-describe": "loom_vault_references_describe",
  github: "loom_vault_github",
  "github-readiness": "loom_vault_github_readiness",
  "github-info": "loom_vault_github_info",
  "github-connections": "loom_vault_github_connections",
  "github-test": "loom_vault_github_test",
  "github-change": "loom_vault_github_change",
  profiles: "loom_vault_profiles",
  "profile-pins": "loom_vault_profile_pins",
  "profile-retire": "loom_vault_profile_retire",
  "profile-requirements": "loom_vault_profile_requirements",
  "profiles-apply": "loom_vault_profiles_apply",
  "profile-resolve": "loom_vault_profile_resolve",
  "profile-run": "loom_vault_profile_run",
  "ssh-exec": "loom_vault_ssh_exec",
  git: "loom_vault_git",
  "ssh-generate": "loom_vault_ssh_generate",
  "ssh-probe": "loom_vault_ssh_probe",
  "ssh-info": "loom_vault_ssh_info",
  "ssh-trust": "loom_vault_ssh_trust",
  "workload-open": "loom_vault_workload_open",
  workloads: "loom_vault_workloads",
  "workload-close": "loom_vault_workload_close",
  status: "loom_vault_status",
  brokers: "loom_vault_brokers",
  "broker-invite": "loom_vault_brokers_invite",
  "broker-apply": "loom_vault_brokers_apply",
  grants: "loom_vault_grants",
  "grant-preview": "loom_vault_grants_preview",
  "grant-apply": "loom_vault_grants_apply",
  explain: "loom_vault_access_explain",
  readiness: "loom_vault_readiness",
  delegate: "loom_vault_grants_delegate",
  list: "loom_vault_items",
  change: "loom_vault_change",
} as const;
export const vaultCommand = Command.make("vault").pipe(
  Command.withDescription(
    "Inspect Loom Vault or change item lifecycle through the authenticated Loom connection. Enter secret values privately in Loom.",
  ),
  Command.withSubcommands([
    sshAgentExecCommand,
    brokerCommand,
    githubExecCommand,
    ...Object.entries(actions).map(([action, tool]) =>
      Command.make(action, {
        argumentsJson: Argument.String("arguments-json").pipe(
          Argument.withDefault(
            action === "list"
              ? '{"cursor":null,"includeArchived":false}'
              : action === "readiness"
                ? '{"requirements":[]}'
                : "{}",
          ),
        ),
      }).pipe(
        Command.withHandler(({ argumentsJson }) =>
          callForkTool(tool, argumentsJson, NodeProcess.env),
        ),
      ),
    ),
  ] as const),
);
