# L80 product

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
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- D6: What are the initial grant scopes and conflict precedence, and are deny rules necessary?
- Which workloads need OS-user or container isolation beyond broker authorization?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
