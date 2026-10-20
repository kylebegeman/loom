# L81 product

## Summary

Use dedicated Loom-managed SSH keys for development connections and Git operations.

## Available mediated-command milestone

An administrator creates a dedicated Ed25519 key and verifies the host public key independently.
Trust may start empty, be replaced after review or be removed without replacing the user key.
Copy the public key for manual registration; no real host registration is performed automatically.
The authenticated workload needs a separate exact-destination use grant and current machine
heartbeat. A standalone runner signs a bounded command request using both local identities.

Execution occurs on the Loom server, with at most four concurrent commands, eight seconds per
command and 2 KiB of standard output. Results contain the remote exit code and output; the CLI
prints JSON and does not propagate the remote exit code as its own process status. SSH transport
failures fail the CLI. Do not supply secrets in command arguments or print sensitive remote data.
Lost responses, timeout or cancellation may leave remote effects; no automatic retry or remote
rollback is promised.

Web/desktop and native mobile settings now provide creation, public-key copying and reviewed
host-pin replacement/removal. The thread command palette opens the selected computer's Vault.
An explicit fixed-command test reports authentication success for the exact item version;
it does not establish provider/Git readiness or grant future use. Existing item actions handle
archive/restore/delete. Administrator MCP/CLI offer the same actions; agents cannot approve
their own trust or invoke the administrator probe. Automatic operation-scoped SSH/Git tools now use the connection already established at
provider/task launch. Ordinary terminal routing, clone/push, imports and the remaining
complete packet outcome stay selected.

## Available terminal activation

From an authenticated active agent terminal, choose a dedicated key and its current version,
then explicitly run ordinary SSH or Git through `loom vault ssh-agent-exec`. The command gets
one temporary agent, pinned host trust and isolated configuration. Output and exit status are
preserved. Completion, cancellation or timeout removes local activation state; inspection and
close are also available through the authenticated CLI/MCP connection.

This requires a host SSH use grant. A repository-only Git grant remains appropriate for the
mediated Git tool and does not authorize unrestricted host authentication. Pi and ACP work with
their existing terminal connection; other native harnesses need explicit terminal setup or use
hosted MCP operations. No personal key-manager prompt or automatic personal-key fallback is
part of the flow. The connection originates on the invoking host. Five-minute expiry and live
signing checks do not revoke an already authenticated connection or undo its remote effects.

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

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Initial generated keys and host pins use Ed25519. Private keys are stored as PKCS8 inside the encrypted item payload. Imports and additional algorithms remain open.
- D7 is resolved for this milestone: mediated connections from the Loom server, operation-scoped POSIX sockets, verified OpenSSH host-bound authentication and no forwarding. Explicit POSIX terminal relay sockets are now implemented with host SSH grants; persistent shell attachment, additional runner modes and Windows transports remain open.
- Is commit signing part of a later extension of this packet? It is not required by the current SSH outcome.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
