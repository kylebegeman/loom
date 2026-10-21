# L106 testing

## Feature proofs to implement

Proposed files, not existing tests:

- `packages/contracts/src/fork/personal-vault-agents.test.ts`: bounded exact schemas; reject secrets/arbitrary bodies; canonical HTTPS origins, default ports, lookalike domains, redirects and operation-parameter substitutions.
- `apps/server/src/fork/personal-vault-agents/AgentOperations.test.ts`: caller-derived run/environment, no self approval, current authority and item versions, nonce replay, sibling/subagent ownership, revoke/invoke races, deadline boundaries, unavailable trusted device, scheduled-run parity and command-job rejection.
- `apps/server/src/fork/personal-vault-agents/AgentOperations.recovery.test.ts`: fixture effect succeeds before receipt loss, restart sees unknown, no duplicate write, cancel before/after commit, expired session cleanup failure and independent upstream invalidation receipts.
- `packages/client-runtime/src/fork/personal-vault-agents.permissions.test.ts`: destination permissions, stale result invalidation on environment change, safe inspection and capability/version absence. A forged opaque handle never authorizes an operation.

Trusted-executor tests must actually run under an attacker fixture with the agent host's same-user full-access powers: read process/files, invoke exposed IPC, change host DB/code, call preview evaluate, scrape permitted page state and replay recorded requests. Demonstrate the external trust boundary, not merely a mocked denial. No password may appear in an agent-readable DOM, evaluate result, screenshot, clipboard, log, prompt, shell snapshot or Library record. For any claimed lending adapter, attempt writes and token/session extraction; reject unsupported authority rather than masking UI controls.

## Focused commands after implementation

These planned commands are **not run** and name files to create:

```sh
vp test run packages/contracts/src/fork/personal-vault-agents.test.ts apps/server/src/fork/personal-vault-agents/AgentOperations.test.ts apps/server/src/fork/personal-vault-agents/AgentOperations.recovery.test.ts packages/client-runtime/src/fork/personal-vault-agents.permissions.test.ts
vp lint packages/contracts/src/fork/personal-vault-agents.ts packages/client-runtime/src/fork/personal-vault-agents.ts apps/server/src/fork/personal-vault-agents apps/web/src/fork/personal-vault-agents
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
```

Add desktop/mobile lint/typechecks only for surfaces actually changed, including `vp run lint:mobile` for mobile. Validate trusted native targets with their actual build/test commands once inventoried. Use controlled clocks, receipts, Deferreds or worker drains, never sleeps. Run existing Vault/preview regressions only where actual integration changes warrant them.

## Integrated acceptance, when authorized

Kyle or an authorized primary agent uses a fixture account from an independently trusted Mac/iPhone; requests originate from each provider through the common service. Verify Safari and Chromium independently, local and remote/relay/tunnel binding, visible denied/expired/unknown states, and cleanup after device/server restart. Deliberately open an upstream or older server and unsupported Android/Windows/Linux/web surface: no credential fallback. No browser, device, server or live account was opened during packet design.

## Evidence and merge safety

Current evidence: source review and documentation checks only; no feature behavior claimed. Once code exists record the focused results and nightly merge preview. Main-only `scripts/fork/loom.sh integrate nightly --dry-run` belongs to the later integration step, not this shared-checkout design task.
