# L79 product

## Summary

Give each execution host a durable identity and reliable unattended credential access.

## How it works

Enroll a host through a reviewed, expiring challenge, then issue a renewable machine identity held outside projects. A local broker exposes authenticated per-workload channels and obtains bounded use leases. Report boot, unlock, reconnect, disable and re-enrollment states explicitly.

## User experience

Enroll Dorothy from a remote client, see whether its service can start unattended, and inspect the actual runner context. Disable a lost host, re-enroll a replacement and see the limits of outstanding leases.

## Why it improves the product

Removes reliance on an interactive personal desktop session and gives remote workers a consistent setup.

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

Implements the broker portion of ext-vault; optional delivery adapters register capabilities. Unlocks SSH, CI and runner integrations. Must work without V14 interactive approvals by accepting already granted access or returning a precise denial.

## Decisions and open questions

Confirmed: Kyle selected this complete idea for implementation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- D4: Which macOS, Linux and Windows broker modes are in the initial supported matrix?
- D5: Is offline use required at launch, and what maximum revocation delay is acceptable?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
