# L72 testing

Status: local milestone verified on 2026-10-18 with synthetic data. The complete PRODUCT scope
remains in progress. No live deployment, personal-vault migration or provider registration ran.

## Focused automated evidence

Service tests prove that backend/workload/grant failures and absent broker/delivery support do
not become success, reports name the server context and have a 60-second freshness boundary,
and restricted runners cannot gain authority from a grant. Transport tests cover inspection
rights and authenticated MCP identity.

The combined focused runs passed **76 tests** across Vault domain/backend/private-input,
RPC/MCP authorization, contract, destination-permission, cross-list refresh and registration
coverage. The separate fixture-home fix passed six tests. The actual OpenBao 2.7.1 fixture
passed its initial and clean-restored stages, each with two applicable tests and two deliberately
skipped tests for the other stage. Restored grants and revocation remain effective.

Contracts, server, client-runtime, web and mobile typechecks passed. Changed-file lint and
format checks passed; mobile static verification passed SwiftLint, ktlint and detekt. Existing
unrelated Effect suggestions remain suggestions. No repo-wide suite was run.

Reproduce the central behavior tests with:

```sh
vp test run apps/server/src/fork/vault/VaultAccess.test.ts apps/server/src/fork/vault/access-mcp.test.ts apps/server/src/fork/vault/access-rpc.test.ts packages/client-runtime/src/fork/vault-core.refresh.test.ts
```

Use the [operating guide](../../operations/vault.md) for the disposable real backend proof.

## Authorized integrated evidence

Kyle authorized web and mobile checks. The existing app-owned Browser and Device panels ran
against the worktree's isolated `.t3` environment and loopback disposable OpenBao. The matching
iOS native client was built and installed on a dedicated iOS 26.5 simulator.

Web: checked a stopped fixture thread, read connection/workload/grant diagnostics, observed
unsupported delivery for a use request, and let a report become visibly stale after a minute.
Policy changes invalidated the old result. Native iOS: selected the same thread and item, saw
management denied while stopped, then allowed metadata inspection with readiness still blocked
by the inactive workload. No check reported working SSH/GitHub or launched an interactive login.

Native form sheets were checked at their expanded detent. Header insets were corrected to keep
content below native navigation bars. Some XCTest snapshots omitted visible controls; screenshot
coordinates were used only after inspecting the current device image. Evidence is retained in
the thread's browser artifacts and disposable QA files, outside the repository.

## Remaining acceptance

Complete the remaining PRODUCT outcomes documented in README/IMPLEMENTATION. Electron shell,
Android interactions, relay/tunnel behavior, upstream-server version skew, screen-reader use,
readiness cancellation during a delayed request and permission loss during a pending UI operation
were not independently verified in this pass. Do not infer those from the native build or a
passing typecheck. No enrolled runner, SSH signing, external service authentication, profile
binding, approval workflow or full immutable audit is implemented by this chunk.

Changed Markdown links, whitespace and the seam manifest were checked. No new upstream seams
were added by these three features. The committed merge-tree preview against the newest locally available nightly,
`v0.1.1-nightly.20261017.3238`, exited 0 with no conflicts. No fetch or full production
integration rehearsal was run.

## GitHub terminal/readiness verification

The shared milestone passes 47 focused tests in eight files, scoped consumer typechecks,
changed-source lint and mobile native static checks. Web/iOS verified synthetic credential
failure, thread-specific denial and reference-only command copying; web also verified narrow
layout and expiry. Service cancellation releases the acquired provider session. Full evidence,
commands, merge baseline and live-provider/runner limits are in
[L82 testing](../L82-vault-connectors/TESTING.md#github-terminal-and-live-readiness-milestone).
The complete selected packet remains In progress.
