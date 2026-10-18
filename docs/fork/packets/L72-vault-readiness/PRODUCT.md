# L72 product

## Current delivery boundary

The local milestone checks OpenBao connectivity, authenticated thread liveness and up to
16 explicit item/action/destination requirements through the execution evaluator. Results name
the Loom server context, include repair guidance and expire after 60 seconds. Web/desktop and
mobile can cancel a pending check; RPC, CLI and MCP use the same bounded service.

Use/reveal/export requests and empty requirement sets report missing broker/delivery support.
The backend check does not prove item-write privileges. An allowed grant does not prove SSH,
GitHub authentication, host trust, provider tools or unattended launch readiness.

The complete selected product below remains the acceptance target. Implement enrolled broker/runner context probes, profile requirement discovery, harmless
SSH/GitHub/provider checks and network/host-trust/tool failure classification. Integrate
preflight with project launches and schedules. Durable long-running check operations are not
needed by the current bounded server check, but remain required for future external probes.

## Summary

Prove an environment can perform its configured unattended work before launching a task.

## How it works

Run bounded checks inside the actual broker or runner context. Resolve profile requirements, verify unlock and grant state, and exercise harmless provider-specific operations such as repository reads. Classify authentication, authorization, network, host-trust and missing-tool failures separately; record check time and environment identity.

## User experience

Open Vault readiness from the environment, project, command palette or task preflight. See a concise result with a repair action for each failure, retry a single check, or cancel an active run. A stale successful check is visibly stale.

## Why it improves the product

Prevents a terminal login from being mistaken for proof that a background runner is ready.

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

Uses shared inspection and connector-check interfaces. Can check existing GitHub setup before Vault migration; absent optional adapters report unsupported, not success. Unlocks preflight for schedules and newly enrolled machines.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. The delivered decisions are recorded in TECHNICAL.md; these broader choices remain:

- Which checks block a launch versus warn, and what freshness window is acceptable?
- Should scheduled tasks require preflight by default or only when their profile requests it?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
