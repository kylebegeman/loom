# L75 product

## Summary

Bind a complete set of development accounts, credentials and endpoints to a named project environment.

## Current milestone and full scope

Explicit prompt attachments and blocking provider preflight are now part of the local milestone.
Links contain references only and do not grant access. The local milestone is described in [README.md](./README.md). The complete selected outcome
below remains the acceptance target; pending consumers are not implied by local management.

## How it works

Projects declare named requirements such as GitHub access, a staging API key and test-account roles. Environment-local profiles map requirements to Vault references and non-secret endpoints. Resolve one reviewed profile revision per run so mid-run edits do not silently switch identities.

## User experience

Choose Local development or Staging QA, review account labels and missing requirements, and launch with the selected profile. Clone, edit, unbind, deactivate or restore a profile revision without duplicating secret values.

## Why it improves the product

Reduces account mix-ups and repeated configuration across worktrees and machines.

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

Uses reference and grant interfaces; connectors supply validation when installed. Unlocks reproducible task templates, previews and onboarding. Degrades to missing requirements when optional account provisioning is absent.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which profile metadata should be shared through Library, and which stays strictly environment-local?
- SSH/Git resolution pins the profile and key versions on first use in a run. A key version change requires a new run. Version-following policy for future credential kinds remains open.
- Portable declarations contain names/kinds only and start unbound on import. Durable pin inspection/retention, Library publication and project-file discovery remain open.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
