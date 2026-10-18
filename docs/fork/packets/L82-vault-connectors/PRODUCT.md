# L82 product

## Summary

Manage GitHub and other developer service identities as tested, renewable connections.

## How it works

Use service-supported OAuth, app installations, tokens or service accounts. Store identity metadata and refresh material through Vault; supply API and Git credentials through the selected broker adapter. Record supported operations and repository reach instead of interpreting sign-in as universal access.

## User experience

Connect GitHub, review the account and permissions, select it for a project and test API plus Git access. Reconnect, replace, disconnect or request provider revocation with an explicit result.

## Why it improves the product

Fixes the split where pull requests work but fetch/push or another runner fails.

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

Uses shared storage, grants and delivery interfaces. Starts with GitHub; other connectors register independently and do not become compulsory dependencies. Unlocks registries, deployments and infrastructure providers.

## Decisions and open questions

Confirmed: this complete idea is selected for documentation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- D8: Which GitHub identity mechanism best fits Kyle's repositories and service-account ownership?
- Which additional services are initial commitments versus later connector implementations?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) before moving
this packet into the implement-now queue. Do not silently reduce the selected scope.
