# L28: Automatic account failover

Status: Retired. Kyle approved retiring the whole packet on 2026-10-09: Switchboard, Kyle's
external tool, already resumes rate-limited agents automatically, which covers account
failover (Loom's Switchboard mode routes Claude and Codex through it; see FORK.md). Nothing
was built. The documents below describe the retired design and are kept for reference only;
do not implement them.

When a provider usage limit stops a thread, Loom should be able to continue it on another
eligible subscription account. Kyle retained this feature on 2026-09-27. It is an optional
improvement and may remain deferred indefinitely without blocking other work.

## Upstream ownership

The inspected V2 branch already provides reset-time resumption, cancellation, persistence
and client controls. Reuse the released upstream feature rather than build a second resume
scheduler. Automatic eligible-account selection was not present in the inspected recovery
worker; verify that again after V2 ships.

- [V2 PR #2829](https://github.com/pingdotgg/t3code/pull/2829)
- [Recovery worker at the inspected commit](https://github.com/pingdotgg/t3code/blob/0dcb029dafc93401bd115f62a0c934b20e6bf850/apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts)

## Retained scope

- Automatic selection of an eligible subscription account after a usage-limit stop.
- Clear control over which accounts participate, visibility of a switch, and a way for
  the user to cancel or take over.
- No automatic fallback to metered accounts without an explicit opt-in.
- Coordination with upstream recovery so only one continuation starts.

Unknown-reset retries remain deferred. Provider compatibility, account selection details,
settings, commands, persistence and UI must be reassessed against released V2 behavior.
The previous design's account restrictions and defaults are not final V2 requirements.

## Resuming planning

After V2 ships, inspect its actual recovery and account-switch behavior, identify any
remaining gap, and finalize this packet with Kyle before implementation. Do not build a
V1 substitute or a speculative V2 adapter in the meantime.

[PRODUCT.md](./PRODUCT.md) records the current decision. TECHNICAL.md, SEAMS.md,
IMPLEMENTATION.md, TESTING.md and REFERENCES.md preserve the superseded V1 design as
reference only; their implementation instructions do not apply to the retained scope.
See the [shared planning policy](../README.md#planning-policy-after-the-upstream-review).
