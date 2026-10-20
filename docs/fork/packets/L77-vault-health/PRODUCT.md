# L77 product

## Summary

Collect expiration and authentication maintenance into one actionable inbox.

## How it works

Combine declared expiry, connector validation and delivery failures into deduplicated issues keyed by item and failure class. Perform bounded, rate-aware background checks. Close resolved issues, preserve useful history and distinguish provider outages from revoked credentials.

## User experience

See expiring or broken access with affected projects and a repair action. Snooze, unsnooze, dismiss a stale warning or recheck after a fix. Repeated failures update one issue instead of sending repeated alerts.

## Why it improves the product

Reduces interruptions and prevents authentication failures from becoming scattered chores.

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

Uses item metadata, usage events and optional validation adapters. Can work with manual expiry before automated rotation exists. Unlocks maintenance planning and renewal automation.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Implemented defaults: seven-day expiry warning (typed rules allow one to ninety), 256 issues,
  128 rules and 32 mutation receipts. Omission counts are visible; notifications stay in the inbox.
- Automatic GitHub validation is explicit opt-in for a dedicated connection/repository. Snapshot
  and project-context reads do not contact providers. Additional connector checks remain selected.
- Outage reports group open/snoozed issues by a recorded GitHub endpoint or SSH host/port, without claiming a common cause. Disposition and recovery remain per item; reports without a known destination stay individual.
- Current and retained references, explicit external-consumer limits and web maintenance acceptance are implemented. Native/remote acceptance and other validation adapters remain incomplete.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
