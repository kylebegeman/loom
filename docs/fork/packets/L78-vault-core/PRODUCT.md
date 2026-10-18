# L78 product

## Summary

Create the shared home for development credentials and extensible secure records on Kyle's infrastructure.

## How it works

Provide authenticated metadata and encrypted versioned payload storage behind a backend adapter. Host the authority alongside the begam.in/Loom platform on the VPS if that deployment is selected. Separate human platform identity, machine enrollment, storage-key custody and workload grants.

## User experience

Manage named SSH keys, service connections, account records, secure notes and secure files through one Vault surface. Create, inspect metadata, replace, archive, restore and explicitly delete records, with clear locked and unavailable states.

## Why it improves the product

Establishes a reusable platform capability instead of a separate secret store for each integration.

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

Owns the storage/control-plane implementation of proposed ext-vault interfaces. All other proposals consume that boundary rather than this packet's UI. Baseline audit, durable writes and a proven backup/restore path are required before real credentials; V16 adds full recovery management.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- D1 resolved: Kyle selected self-hosted OpenBao behind Loom UI/account/broker boundaries.
  OpenBao 2.7.1 passed the disposable encrypted-storage/restore proof.
- D2: Who can decrypt stored values, where are wrapping keys kept, and how is unattended unlock recovered?
- D3: How does the existing platform identify a human Vault owner without assuming unverified production auth contracts?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
