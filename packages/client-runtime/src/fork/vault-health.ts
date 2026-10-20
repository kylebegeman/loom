import {
  VAULT_HEALTH_WS_METHODS as V,
  type VaultHealthIssue,
  type VaultHealthSnapshot,
  type VaultHealthContextPage,
  type VaultHealthRetainedPage,
} from "@t3tools/contracts/fork";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";
export function createVaultHealthAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    retained: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:health-retained",
      tag: V.retained,
    }),
    context: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:health-context",
      tag: V.context,
    }),
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:vault:health",
      tag: V.snapshot,
    }),
    apply: createEnvironmentRpcCommand(runtime, { label: "loom:vault:health-apply", tag: V.apply }),
    recheck: createEnvironmentRpcCommand(runtime, {
      label: "loom:vault:health-recheck",
      tag: V.recheck,
    }),
  };
}
export const vaultHealthMessage = (issue: VaultHealthIssue) =>
  ({
    expiry:
      "Declared expiry is approaching or has passed. Renew or replace this development identity.",
    authentication:
      "Authentication failed. Check the dedicated identity and its provider permissions.",
    outage:
      "The provider was unreachable or timed out. Check connectivity before changing credentials.",
    configuration:
      "An operation failed or configuration needs review. Inspect command results and connection settings before retrying.",
  })[issue.category];
export const vaultHealthVisibleState = (issue: VaultHealthIssue, now: number) =>
  issue.state === "snoozed" && issue.snoozedUntil !== null && issue.snoozedUntil <= now
    ? "open"
    : issue.state;

export const vaultHealthRecheckMessage = (outcome: "checked" | "rate-limited" | "unconfigured") =>
  ({
    checked: "Check finished. Review the current issues for its result.",
    "rate-limited": "This item was checked recently. Wait before checking again.",
    unconfigured: "Configure an expiry or validation rule for this item before rechecking.",
  })[outcome];

export function vaultHealthCoverageMessages(
  coverage: VaultHealthContextPage["coverage"] | VaultHealthRetainedPage["coverage"],
) {
  if (!coverage)
    return [
      "This server did not report discovery coverage. Empty results do not establish that the item is unused.",
    ];
  const messages = [
    coverage.scope === "project-page"
      ? "Coverage: current profile bindings and project/thread grants for this page of projects. Inspect retained run selections separately."
      : "Coverage: retained binding snapshots for this page in the selected project. Retired selections without snapshots cannot be attributed to an item.",
    "External consumers are not discovered. Copies held by providers are unknown. Current access has not been evaluated.",
  ];
  if (coverage.scope === "project-page" && coverage.unattributedGrants > 0)
    messages.push(
      `${coverage.unattributedGrants} ${coverage.unattributedGrants === 1 ? "grant referencing this item cannot" : "grants referencing this item cannot"} be attributed to a current project across this environment. Review grants before changing this item.`,
    );
  return messages;
}

export function vaultHealthInboxGroups(snapshot: VaultHealthSnapshot, history: boolean) {
  const issues = snapshot.issues.filter(
    (issue) => history || !["dismissed", "resolved"].includes(issue.state),
  );
  const groupByIssue = new Map(
    (snapshot.outageGroups ?? []).flatMap((group) =>
      group.issueIds.map((id) => [id, group] as const),
    ),
  );
  const emitted = new Set<string>();
  return issues.flatMap<{
    id: string;
    label: string | null;
    issues: ReadonlyArray<VaultHealthIssue>;
  }>((issue) => {
    const group = groupByIssue.get(issue.id);
    if (!group) return [{ id: issue.id, label: null, issues: [issue] }];
    if (emitted.has(group.id)) return [];
    emitted.add(group.id);
    const target = group.target;
    return [
      {
        id: group.id,
        label:
          target.kind === "github"
            ? "GitHub (github.com)"
            : `SSH ${target.hostname}:${target.port}`,
        issues: issues.filter((candidate) => group.issueIds.includes(candidate.id)),
      },
    ];
  });
}
