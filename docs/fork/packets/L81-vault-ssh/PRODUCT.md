# L81 product

## Summary

Use dedicated Loom-managed SSH keys for development connections and Git operations.

## How it works

Generate or explicitly import keys, keep private material behind the broker signing interface, and track public-key registrations and host trust independently. Give workloads a restricted identity set through platform-appropriate agent transport. Validate destination constraints using supported SSH mechanisms or a mediated connection, not an assumed hostname in generic signing requests.

## User experience

Create a development key, copy its public key, register it on selected hosts, test access and replace or revoke it. A changed host key is a separate reviewed trust action. Personal 1Password settings remain untouched.

## Why it improves the product

Directly addresses repeated personal key-manager approvals while retaining SSH workflows.

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

Uses storage, broker and policy interfaces plus SSH adapters. Account connectors may automate public-key registration when available; otherwise provide explicit manual registration. Unlocks remote workers and optional future commit signing.

## Decisions and open questions

Confirmed: this complete idea is selected for documentation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which key algorithms and import formats are required initially?
- D7: Select mediated connections versus supported destination-constrained agent use, and decide whether forwarding is supported.
- Is commit signing part of a later extension of this packet? It is not required by the current SSH outcome.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) before moving
this packet into the implement-now queue. Do not silently reduce the selected scope.
