# L81 implementation

Status: **In progress**. Kyle authorized the complete packet. This local milestone implements
thread/project grants; it does not deploy a service or migrate personal credentials.

## Delivered

The local milestone provides environment-owned thread/project grants, one default-deny
evaluator, exact item/action/project/destination scopes, bounded validity windows, parent
attenuation and authenticated direct-child delegation. Grant revisions and permanent revocation
survive restart and OpenBao restore. UI changes require an explicit preview and apply;
suspension is reversible. Workload identity comes from ThreadManagement, never prompt text.

Existing agent metadata, private ingress and lifecycle paths enforce the evaluator and T3's
permission ceiling. Human environment administration remains governed by access:read/write;
agent threads cannot administer root grants. Scheduled jobs may use their authenticated T3
thread, but enrollment, workload leases and external runner attestation are not delivered.

## Remaining

Finish enrolled machine/runner identities, schedule attestation beyond T3 thread identity,
platform membership and role mapping, external-use leases and broker revocation propagation.
Decide which deployment boundaries require separate OS users or containers. The current
allow-list union has no explicit deny rules. Same-user full-access processes remain outside
any promise of per-item host isolation.

Use the complete PRODUCT target and shared extension contract when extending this milestone.
Keep thin transports and one execution evaluator. Checks and integrated evidence are in
[TESTING.md](./TESTING.md). No production rollout is implied by passing local verification.
