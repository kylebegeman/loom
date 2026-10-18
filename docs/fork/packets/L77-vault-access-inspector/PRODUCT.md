# L77 product

## Summary

Explain effective credential access and the impact of changing it.

## How it works

Expose the same policy evaluator used at execution as an authorized explanation service. Join grant provenance, bindings, recent safe usage and pending requests. Preview a versioned policy or removal against known consumers without claiming knowledge of external copies.

## User experience

Open Why this access? from an item, denial or run. See the actual account, granting rule and affected projects; preview a change, inspect its scope, then apply or abandon it.

## Why it improves the product

Keeps Vault understandable as access relationships grow and makes denials repairable.

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

Uses the shared evaluator, metadata and minimum audit interfaces. Approval and rotation features add relationships when present. Unlocks access reviews and more reliable support diagnostics.

## Decisions and open questions

Confirmed: this complete idea is selected for documentation. The personal/development Vault
separation and self-hosting option are product requirements. Proposed behavior above remains
subject to design review; the following choices are not resolved by selection:

- Which usage details may project members see versus Vault administrators?
- What audit history window should explanations include by default?

Resolve relevant [shared gates](../LOOM-VAULT.md#design-decisions-before-building) before moving
this packet into the implement-now queue. Do not silently reduce the selected scope.
