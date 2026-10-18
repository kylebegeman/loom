# L87 product

## Summary

Make the self-hosted Vault recoverable and movable without losing access control.

## How it works

Create encrypted consistent backups covering payloads, metadata and required policy state. Keep recovery material separately managed. Restore into an isolated destination, verify decryption and policy integrity, then explicitly promote it with old-machine trust reviewed or invalidated.

## User experience

See last verified recovery, download an encrypted export, perform a recovery exercise and move servers through a reviewed workflow. Lost-device recovery shows what access can be disabled and what downstream credentials need rotation.

## Why it improves the product

Preserves ownership and makes Vault dependable as a shared infrastructure dependency.

Complexity: **Large**. Impact: **High**.

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

Uses backend snapshot/export, key-custody and machine-revocation interfaces. Builds on the minimum restore capability required by ext-vault rather than postponing all backups. Unlocks server migration and future hosting changes.

## Decisions and open questions

Confirmed: this complete idea is selected for documentation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- D9: Choose backup destination, retention, recovery owner and acceptable recovery time/data loss.
- How is authoritative revocation state recovered when the original server and its latest log are unavailable?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) before moving
this packet into the implement-now queue. Do not silently reduce the selected scope.
