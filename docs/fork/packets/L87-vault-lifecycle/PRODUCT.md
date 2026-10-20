# L87 product

## Summary

Issue temporary access and rotate long-lived credentials without losing track of consumers.

## How it works

Adapters issue expiring credentials or certificates where supported. Rotation prepares a replacement, validates selected consumers, cuts over bindings, then retires the old version when the provider permits overlap. Track partial results and reconcile retries; providers allowing only one valid secret require an explicit interruption strategy.

## User experience

See leases and renewal status, review a prepared rotation and its affected projects, pause automation or repair a failed consumer. Emergency revoke reports which upstream credentials were actually revoked.

## Why it improves the product

Reduces manual renewal and static-secret sprawl as automation grows.

Complexity: **Massive**. Impact: **High**.

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

Uses provider capability, lease, usage and versioned-binding interfaces. Works with one selected issuance adapter; cannot claim rotation for an unsupported service. Unlocks task-duration SSH certificates, temporary database users and disposable infrastructure.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which issuer should ship first: SSH certificates, a development service token or temporary database users?
- What renewal, overlap and emergency-revocation policies are acceptable?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
