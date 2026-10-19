# L73 product

## Summary

Attach named Vault items without copying their values into prompts or settings.

## Current milestone and full scope

Explicit prompt attachments and blocking provider preflight are now part of the local milestone.
Links contain references only and do not grant access. The local milestone is described in [README.md](./README.md). The complete selected outcome
below remains the acceptance target; pending consumers are not implied by local management.

## How it works

Use opaque stable IDs and a shared metadata picker. Search authorized labels, account roles and environments with bounded queries. Renames preserve bindings; a new secret version does not change the reference. Resolving a reference still checks the destination principal at execution.

## User experience

Choose a credential from project settings, a composer attachment, the command palette or CLI completion. Inspect its intended consumer, remove the attachment, or replace a binding. The transcript contains a safe reference summary.

## Why it improves the product

Makes Vault available where work starts and avoids brittle names or pasted tokens.

Complexity: **Medium**. Impact: **High**.

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

Uses metadata search, reference resolution and access summaries from the shared foundation. Unlocks profiles, task templates and plugin consumers without requiring their implementation.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which metadata may be shown in saved conversations after an item is retired or access is lost?
- Choose composer presentation and CLI naming without overloading existing skill syntax.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
