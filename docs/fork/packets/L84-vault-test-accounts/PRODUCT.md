# L84 product

## Summary

Manage application test identities as reusable, isolated QA resources.

## How it works

Organize accounts by app, environment and role, with encrypted login and optional TOTP/session material. Adapters can provision, reset, reserve and retire accounts. Reserve atomically with an expiring lease and quarantine dirty accounts until reset succeeds. Optional development inbox adapters retrieve verification messages for dedicated test domains.

## User experience

Ask for an unused staging editor account, inspect the selected identity, use it for a test, then release it. A failed reset shows why the account is unavailable. Personal accounts stay out of the collection.

## Why it improves the product

Makes multi-role and parallel QA repeatable without filling a personal password manager with test identities.

Complexity: **Massive**. Impact: **Transformational**.

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

Uses account records, grants and delivery interfaces. Provisioning and mail adapters are optional capabilities; stored accounts remain usable without automatic creation. Unlocks disposable environments, seeded scenarios and parallel test workers.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which application and test environment should supply the first provisioning adapter?
- Which owned test-mail domain and mail service should be used, and what cleanup rules apply?
- How should shared accounts differ from exclusive reservations, and which sessions may be reused?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
