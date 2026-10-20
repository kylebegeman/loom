# L78 testing

Status: local milestone verified on 2026-10-18 with synthetic data. The complete PRODUCT scope
remains in progress. No live deployment, personal-vault migration or provider registration ran.

## Focused automated evidence

Tests verify shared execution/explanation decisions, own-thread metadata filtering, bounded
known impact and unknown consumers, stale preview conflicts, authenticated MCP identity and
read/write transport ceilings. One evaluator serves execution, explanations and readiness.

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

Web: checked allowed inspection and denied management for a stopped fixture thread; inspected
explicit unknown consumers; applied/abandoned change previews; verified policy-change invalidation,
contextual item selection and active-thread palette preselection. The latter exposed and fixed
navigation atom lifetime. The 430-pixel layout fits without horizontal overflow. Native iOS:
checked the contextual sheet, created/reviewed/applied a grant, abandoned a lifecycle preview,
and read both allowed inspection and denied management explanations.

Native form sheets were checked at their expanded detent. Header insets were corrected to keep
content below native navigation bars. Some XCTest snapshots omitted visible controls; screenshot
coordinates were used only after inspecting the current device image. Evidence is retained in
the thread's browser artifacts and disposable QA files, outside the repository.

## Remaining acceptance

Complete the remaining PRODUCT outcomes documented in README/IMPLEMENTATION. Electron shell,
Android interactions, relay/tunnel behavior, upstream-server version skew, screen-reader use,
readiness cancellation during a delayed request and permission loss during a pending UI operation
were not independently verified in this pass. Do not infer those from the native build or a
passing typecheck. Those results do not establish live enrolled-runner login, SSH signing, external authentication,
remote approval acceptance or immutable audit coverage.

Changed Markdown links, whitespace and the seam manifest were checked. No new upstream seams
were added by these three features. The committed merge-tree preview against the newest locally available nightly,
`v0.1.1-nightly.20261017.3238`, exited 0 with no conflicts. No fetch or full production
integration rehearsal was run.

## Related-context milestone

The inspector joins existing authoritative interfaces without a persisted graph or policy change.
Focused server suites pass 72 tests (inspector, evaluator, RPC, MCP and actual fork registration),
and shared display helpers pass three tests. Tests cover metadata denial, requester/provider
filtering, caps with omitted counts, partial context, and run/profile/policy/item/expiry changes
across awaited reads. No transport executes, and policy snapshots remain unchanged by inspection.
Contracts, server, client-runtime, web and mobile typechecks, changed-file lint and native static
checks pass. No simulator pass was run in this lane.

The existing isolated Browser-panel setup verifies denied policy plus partial/empty context,
the explicit external-consumer limits, and a 430-pixel layout without horizontal overflow.
Desktop-sized capture: browser-screenshot-localhost-mvgzqelf-5795b394.png. Narrow capture:
browser-screenshot-localhost-mvgzqr9i-c0d25840.png. These are local browser artifacts, not committed
assets. Matching profile/session/request labels and concurrent drift have service-test evidence;
this browser fixture has a stopped run and does not prove live broker behavior.

Landing-review regressions verify same-thread foreign-requester isolation against the real narrow
policy reader and prove the inspector never builds approvalInbox. Stale item/run requests are
omitted consistently with the evaluator. Per-dimension counterexamples cover profile bindings,
all session identity/expiry filters, approval project/item filters, pending-first/newest sorting
and decided history with past deadlines. Deferreds and TestClock prove concurrent bounded final
reads and prompt partial results from a slow profile source. Persistent profile failures retain
healthy context; a run change during policy evaluation withdraws it. Agent output omits broker
labels/state. Shared rows disambiguate duplicate profile labels and use stable identity keys in
both clients. Grant-change previews retain their separate untracked-profile warning.
