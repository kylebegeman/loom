# L81 product

## Current delivery boundary

The policy supports two environment access modes. Existing and shared environments retain
restricted default-deny thread/project grants. An authenticated human owner can explicitly
declare a personal environment owner-trusted once, enabling metadata inspection and supported
brokered use for authenticated active full-access/default agent runs without recurring
thread/project/provider grants. Profiles are optional connection selections. Both modes use
the same evaluator and current item, run, destination and adapter checks.

The declaration is bound durably to the environment and the human subject that first sets it.
There is no verified platform multi-owner identity or membership model. Another person who can
launch agents in that environment is not distinguished from its owner by a prompt or provider
label; shared environments must keep restricted mode. Owner trust does not authorize a task,
elevate plan/runtime permissions, administer policy/trust, reveal/export values or bypass
format-4 one-time protection. Disabling returns to restricted evaluation without deleting
records, grants or recovery material. Existing authenticated sessions may continue.

Restricted grants retain exact item/action/project/destination scopes, bounded validity,
parent attenuation, authenticated direct-child delegation and permanent revocation. UI grant
changes require preview/apply; suspension is reversible. Workload identity comes from
ThreadManagement, never prompt text. Manage/private-ingress actions remain grant-controlled.
Human environment administration remains governed by access:read/write; agents cannot set
owner policy or administer their own root grants. Signed workload checks, hosted SSH/Git and
GitHub operations consume the same policy rather than a provider-specific bypass.

The complete selected product below remains the acceptance target. Finish enrolled machine/runner identities, schedule attestation beyond T3 thread identity,
platform membership and role mapping, external-use leases and broker revocation propagation.
Decide which deployment boundaries require separate OS users or containers. The current
allow-list union has no explicit deny rules. Same-user full-access processes remain outside
any promise of per-item host isolation.

## Summary

Authorize recurring agent work at a useful scope without granting access to the personal vault.

## How it works

Authenticate machine and workload principals separately. Personal environments can explicitly
enable owner-trusted inspect and brokered use; restricted environments evaluate grants against
item IDs, actions, destinations, project identity and time. Delegated grants remain narrower
than their parent. Credential availability never authorizes the task itself.

## User experience

Enable owner access once for a personal environment, or grant selected repositories/hosts in
restricted mode. Inspect the effective authorization, disable personal access or suspend/revoke
a grant. A refused request explains the specific repair without substituting personal credentials.

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

- D6: Explicit personal owner trust covers active-run inspect/brokered use. Legacy/shared
  environments keep default deny, union of allow grants, exact scopes, parent attenuation,
  online evaluation and permanent revocation. Explicit deny rules and platform role mapping
  remain open. A personal environment declaration is not a verified multi-owner identity.
- Which workloads need OS-user or container isolation beyond broker authorization?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
