# L86 product

## Summary

Resolve exceptional Vault access requests from the device Kyle is using.

## How it works

Persist a request bound to principal, item/action, destination, policy revision and expiry. Notify eligible approvers through the platform; allow once, grant a bounded duration, deny or cancel. Resume only the still-valid requesting operation after the decision is committed.

## User experience

Approve a new development access request from mobile while Dorothy waits visibly. Inspect the requesting task and account. Cancel, deny or let the request expire; existing grants continue without new prompts.

## Why it improves the product

Removes physical proximity from supported authorization workflows without reintroducing approval fatigue.

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

Uses the shared grant evaluator and durable request interface. Existing grants work without this packet. Notification transports are adapters, so absence does not block viewing requests in Loom. Unlocks step-up access for sensitive operations.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Initial approvers are destination environment clients with `access:write`. Fresh human authentication and platform account eligibility remain open.
- Pending requests last ten minutes; timed approvals last five or fifteen minutes. Notification transports remain stubbed, with no initial external channel selected.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
