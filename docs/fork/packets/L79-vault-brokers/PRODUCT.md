# L79 product

## Summary

Give each execution host a durable identity and reliable unattended credential access.

## Available enrollment slice

Generate an identity with `loom vault broker identity` on the intended execution host. In Vault
broker settings, enter its public key, name and platform. Download or share the ten-minute
invitation, claim it on that host, compare the full fingerprint and approve it. Review and
cancel an invitation or permanently disable an identity from either client. A disabled identity
requires a new private directory/key to enroll again.

`loom vault broker run` is a foreground macOS/Linux process. It renews every minute; the
registration heartbeat lapses after two minutes. Restart reuses the same private key and pinned
server connection. Online identity status conveys no item grant, successful provider login or
credential-delivery readiness. No automatic boot service or offline access is available yet.

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

- D4: Foreground macOS/Linux is implemented. Boot/logout modes and Windows remain unresolved;
  Linux and headless Pi integration still require their own host verification.
- D5: This slice is online-only with no decrypted cache. The two-minute heartbeat is machine
  presence, not an offline credential-use allowance. Any offline delivery policy remains open.

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) as the implementation advances. Do not silently reduce the selected scope.
