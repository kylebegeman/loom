# L84 product

## Summary

Give agents, developer tools and automation one consistent way to consume Vault access.

## Available authorization-check milestone

Use a fresh workload public key and an existing use grant to open a session from the active
thread. The calling thread is established by Loom's authenticated MCP context; supplied thread
IDs, project paths or prompt text cannot select another principal. Checks need both that
workload key and the approved machine key. Close through MCP or release through signed HTTP;
sessions expire in five minutes. A signed check reports policy/channel status, never a usable
bearer token or proof of successful SSH/GitHub login.

The supported execution mode is an active full-access/default Loom run with a current broker
heartbeat. Workload setup and session-file transfer are manual in this milestone. Same-user
processes able to read the key files can impersonate those identities. Automatic launch binding,
OS isolation and general delivery remain separate unfinished requirements. L81 now uses fresh
command-bound proofs for bounded mediated SSH execution; authorization-check results still
cannot authorize those operations.

## How it works

Provide a broker-backed CLI, SDK and MCP facade over shared use requests. Prefer purpose-specific SSH agents, Git helpers and authenticated service calls; support scoped environment and temporary-file delivery where tools require raw secrets. Keep management APIs separate from delivery and attach workload identity at launch.

## User experience

Attach a profile to a Loom task or run a CLI command under a selected profile. See which account and delivery method are in use. Cancel the command and clean up its temporary material. Pi and other runners use the same bindings.

## Why it improves the product

Prevents bespoke credential plumbing across every provider, script and plugin.

Complexity: **Large**. Impact: **Transformational**.

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

Implements ext-vault delivery adapters and workload launch integration. Uses storage, broker and grants interfaces without requiring every connector. Unlocks external developer tooling, CI and plugins.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which delivery modes must the initial SDK support, and which tools require unavoidable raw-value delivery?
- How are externally launched CLI processes authenticated without treating a project path as identity?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
