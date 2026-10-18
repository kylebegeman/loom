import { brokerCommand } from "./broker-cli.ts";
// @effect-diagnostics nodeBuiltinImport:off -- CLI process boundary reads its authenticated connection environment.
import * as NodeProcess from "node:process";
import { Argument, Command } from "effect/cli";
import { callForkTool } from "../cli/callTool.ts";
const actions = {
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
    brokerCommand,
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
