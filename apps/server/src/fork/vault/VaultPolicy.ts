import type { VaultAccessAction, VaultAccessDecision, VaultGrant } from "@t3tools/contracts/fork";

export interface VaultWorkload {
  readonly threadId: string;
  readonly projectId: string;
}
const denial = (
  reason: VaultAccessDecision["reason"],
  policyRevision: number,
): VaultAccessDecision => ({
  allowed: false,
  reason,
  policyRevision,
  grantId: null,
  grantRevision: null,
  expiresAt: null,
  lineage: [],
});
export const grantMatchesWorkload = (grant: VaultGrant, workload: VaultWorkload) =>
  grant.definition.principal.kind === "thread"
    ? grant.definition.principal.id === workload.threadId
    : grant.definition.principal.id === workload.projectId;

export function grantAttenuates(parent: VaultGrant, child: VaultGrant): boolean {
  const p = parent.definition,
    c = child.definition;
  return (
    p.actions.includes("delegate") &&
    c.itemIds.every((id) => p.itemIds.includes(id)) &&
    c.actions.every((action) => p.actions.includes(action)) &&
    (p.projectId === null || c.projectId === p.projectId) &&
    (p.destination === null || c.destination === p.destination) &&
    c.notBefore >= p.notBefore &&
    (p.expiresAt === null || (c.expiresAt !== null && c.expiresAt <= p.expiresAt))
  );
}
export function evaluateVaultPolicy(
  grants: readonly VaultGrant[],
  workload: VaultWorkload,
  request: {
    readonly itemId: string;
    readonly action: VaultAccessAction;
    readonly destination: string | null;
  },
  now: number,
  revision: number,
): VaultAccessDecision {
  const byId = new Map(grants.map((grant) => [grant.definition.id, grant]));
  let result = denial("no-grant", revision);
  for (const grant of grants) {
    const d = grant.definition;
    if (
      !grantMatchesWorkload(grant, workload) ||
      !d.itemIds.includes(request.itemId) ||
      !d.actions.includes(request.action)
    )
      continue;
    const visited = new Set<string>();
    let current = grant;
    let reason: VaultAccessDecision["reason"] = "allowed";
    while (true) {
      const definition = current.definition;
      if (visited.has(definition.id)) {
        reason = "invalid-lineage";
        break;
      }
      visited.add(definition.id);
      if (current.state !== "active") {
        reason = "not-active";
        break;
      }
      if (now < definition.notBefore) {
        reason = "not-yet-valid";
        break;
      }
      if (definition.expiresAt !== null && now >= definition.expiresAt) {
        reason = "expired";
        break;
      }
      if (definition.parentId === null) break;
      const parent = byId.get(definition.parentId);
      if (!parent || !grantAttenuates(parent, current)) {
        reason = "invalid-lineage";
        break;
      }
      current = parent;
    }
    if (
      reason === "allowed" &&
      ((d.projectId !== null && d.projectId !== workload.projectId) ||
        (d.destination !== null && d.destination !== request.destination))
    )
      reason = "scope";
    if (reason !== "allowed") {
      result = denial(reason, revision);
      continue;
    }
    return {
      allowed: true,
      reason,
      policyRevision: revision,
      grantId: d.id,
      grantRevision: grant.revision,
      expiresAt: d.expiresAt,
      lineage: [...visited],
    };
  }
  return result;
}
