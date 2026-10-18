# L80 product

## Current delivery boundary

The local milestone provides environment-owned thread/project grants, one default-deny
evaluator, exact item/action/project/destination scopes, bounded validity windows, parent
attenuation and authenticated direct-child delegation. Grant revisions and permanent revocation
survive restart and OpenBao restore. UI changes require an explicit preview and apply;
suspension is reversible. Workload identity comes from ThreadManagement, never prompt text.

Existing agent metadata, private ingress and lifecycle paths enforce the evaluator and T3's
permission ceiling. Human environment administration remains governed by access:read/write;
agent threads cannot administer root grants. Scheduled jobs may use their authenticated T3
thread, but enrollment, workload leases and external runner attestation are not delivered.

The complete selected product below remains the acceptance target. Finish enrolled machine/runner identities, schedule attestation beyond T3 thread identity,
platform membership and role mapping, external-use leases and broker revocation propagation.
Decide which deployment boundaries require separate OS users or containers. The current
allow-list union has no explicit deny rules. Same-user full-access processes remain outside
any promise of per-item host isolation.

## Summary

Authorize recurring agent work at a useful scope without granting access to the personal vault.

## How it works

Authenticate machine and workload principals separately. Evaluate grants against immutable item IDs, actions, intended destinations, project identity and time bounds. Child tasks receive a provable subset; human approval creates a specific grant or single-use decision rather than a blanket bypass.

## User experience

Grant a runner access to selected repositories or hosts, inspect inherited permissions, suspend a grant, shorten it or revoke it. A request outside the grant yields one clear explanation.

## Why it improves the product

Makes unattended work predictable while keeping access ownership visible and changeable.

Complexity: **Large**. Impact: **Transformational**.

## Entry points and reverse actions

The flows above must be reachable through the Vault workspace, their relevant project or
environment context and discoverable palette actions. CLI and agent access follow the
technical service boundary. Each mutable flow includes cancellation or an explicit irreversible
step, plus a way to inspect its current state. Narrow/mobile layouts retain task context and
restore focus when a dialog closes.

## States

Show loading, empty, ready, permission denied, unsupported, locked and disconnected states
where applicable. In-progress work is cancellable where the external operation permits it;
otherwise report the committed operation and reconcile its eventual result. Never show success
because a request was merely accepted. Use accessible labels and textual status, not color alone.

## Surfaces and connection modes

Web and desktop: management and inspection are required through the shared client runtime.
Mobile: the equivalent management/status flow is required, including private input and pending
requests when relevant. CLI and MCP call the same services, with narrower rights where needed.
Local, direct remote, Tailscale, relay and tunnel connections must address the selected execution
environment. An upstream or older server without the capability shows unavailable without
breaking its normal workflows. The proposed platform web surface uses the same authority and
never reads a remote environment's credentials from the browser's local machine.

## Dependencies and future opportunities

Implements ext-vault policy and principal interfaces. Metadata readers, SSH and connectors share the evaluator. Optional approvals consume its decisions; missing approval UI means a typed denial, not automatic permission.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. The delivered decisions are recorded in TECHNICAL.md; these broader choices remain:

- D6 is resolved for the local milestone: default deny, union of allow grants, exact scopes,
  parent attenuation, online evaluation and permanent revocation. Explicit deny rules and
  platform role mapping remain open.
- Which workloads need OS-user or container isolation beyond broker authorization?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
