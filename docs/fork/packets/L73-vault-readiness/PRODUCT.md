# L73 product

## Current delivery boundary

General readiness checks OpenBao connectivity, authenticated run liveness and up to 16
item/action/destination requirements through the shared execution evaluator. Empty requirements
inspect the current run's retained profile and pinned versions, then the project default only
when no pin exists. Profiles are optional; no profile means no connection has been selected,
not a missing setup requirement. SSH/Git requirements inspect enrolled-broker presence.
Results name the Loom server context, include repair guidance and expire after 60 seconds.
Web/desktop and mobile can cancel a pending check; RPC, CLI and MCP share the bounded service.

Use/reveal/export requests and empty requirements retain an unsupported live-delivery check.
Configuration and broker presence never prove selected-host execution or upstream login.
An allowed personal-mode or grant decision does not prove item-write privileges, SSH/GitHub
authentication, host trust, provider tools or unattended launch readiness. Dedicated GitHub
API/GH CLI/Git HTTPS probes remain a separate connector operation.

The complete selected product below remains the acceptance target. Selected-host broker/runner
execution, live SSH/additional provider checks, broader failure classification and integrated
remote/platform acceptance remain. Profile discovery, retained-pin revalidation, observational
broker presence and launch/schedule configuration guards are implemented. Dedicated GitHub
probes use the connector readiness service. Future external checks may need durable long-running
operation records; the current bounded observations do not.

## Summary

Prove an environment can perform its configured unattended work before launching a task.

## How it works

Run bounded checks inside the actual broker or runner context. Resolve a resource or optional
profile requirements, verify unlock and current access policy, and exercise harmless
provider-specific operations such as repository reads. Classify authentication, authorization,
network, host-trust and missing-tool failures separately; record check time and environment
identity.

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

## Explicit GitHub terminal use and live checks

Connection management now offers cancellable API/GH CLI/Git HTTPS readiness, optionally for a
selected thread, and a reference-only terminal command to copy. Use the explicit Vault wrapper
for supported gh and Git HTTPS commands without a personal key-manager prompt. It acts on the
execution computer's checkout and preserves output/exit status. A host-only success does not
authorize a thread; stale results, run/grant denials and provider failures remain distinct.
Existing shell logins, SSH remotes and independently launched runners are not migrated.
