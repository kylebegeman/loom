# L106 technical design

Proposed design, verified against source baseline `36de6bbd1d`. New paths and method names below are implementation proposals.

## Existing boundary and constraint

`apps/server/src/fork/vault/VaultCore.ts:104` reads stored values and `:149` returns revealed values. Its OpenBao protection is server-readable, not personal client custody. `VaultPolicy.ts:37` in that directory evaluates development grants; it does not protect personal keys from a full-access host agent. Existing approval clients are environment permissions, not independent human presence; see [L86](../L86-vault-approvals/TECHNICAL.md).

`apps/server/src/mcp/toolkits/preview/handlers.ts:230` returns evaluate results; `tools.ts:267` in that directory explicitly permits mutation. Never fill a personal credential into those controllable pages. `apps/server/src/fork/vault/VaultTestAccountWorkloads.ts:239` provides a useful revalidation pattern, but `:261` explicitly reports `canDeliver: false`; it is not a personal session broker.

## Proposed operation protocol

Use the maintained engine selected through [L102 custody](../L102-personal-vault-custody/) for credential/key storage and item identity/version semantics. A personal operation approval is an independently authenticated application authorization, not a new encrypted database format. Its primitive must actually exist and withstand host-agent impersonation; otherwise the operation is unavailable.

Use `packages/contracts/src/fork/personal-vault-agents.ts` for bounded schemas. Proposed nonstreaming RPC tags `loom.personal-vault-agents.request`, `.inspect`, `.cancel`, `.invoke` and `.close` carry an operation ID, opaque account selection reference, canonical origin, adapter operation ID/validated parameters, deadline and expected revision. Requester identity, environment/thread/run and provider instance come from authenticated transport context, never claimed IDs. Results contain status, permitted result fields and redacted receipts; reject password, seed, cookie/token, key and arbitrary header/body fields. Cap request/result sizes, reject unrecognized operation parameters and paginate inspections.

An independent personal authority signs a reviewed request digest binding the exact account/item version, adapter/version, origin, allowed operation, canonical parameter digest, result audience, environment/thread/run, nonce, expiry and authority epoch. A handle is only correlation. Before each side effect the trusted executor rechecks the signed approval, nonce consumption, current item/authority/revocation state, active run and deadline. Concurrent invoke/cancel must serialize there; the development server cannot establish personal authority by modifying its own database. Missing authority freshness means unavailable, not offline reuse.

Environment RPCs include `EnvironmentAuthorizationError` plus typed personal errors: locked, unsupported, denied, stale-authority, conflict, expired, unavailable and outcome-unknown. Existing `packages/contracts/src/fork/clientRpcPermissions.ts:45` guards destination writes; use the corresponding fork map, guarded commands and `permissionAtom`. Environment permission is an additional ceiling, never personal approval.

## Executors and storage

Proposed `apps/server/src/fork/personal-vault-agents/` is a metadata dispatcher only. An independently trusted client executes adapters and owns the authority ledger and authentication material. A companion process under the agent's unrestricted OS user is insufficient without proven IPC, code integrity, debugging and automation isolation; prefer an independently trusted phone for early proofs. A compromised server can deny service but cannot mint approval, substitute parameters or replay an operation.

Persist bounded request/receipt metadata with operation idempotency and cleanup state. Sensitive account labels/task data stay encrypted to approved clients; the host sees opaque IDs and delivery state. Any host-local journal under `<stateDir>/fork/personal-vault-agents/` contains no credential material or personal result bodies. Proposed local custody journal records prepared, approved, executing, succeeded/failed/unknown, cancelled/expired/revoked and cleanup-required. Reserve before an effect; record its receipt afterwards. A restart reconciles reserved/unknown operations rather than repeating them. Define explicit retention before enabling persistence; do not put this in shell snapshots, prompts or Library.

For lending, origin allowlists and storage partitions alone cannot enforce semantic read-only access. Require a separate trusted session executor, tested egress/redirect/subresource policy and upstream reduced authority where available. Password login occurs only in a page the agent cannot observe/control; any later handed-off session must not expose reusable personal credentials. Unsupported sites remain unsupported. Expiry closes local execution; upstream authenticated connections and copied data may outlive it, which must be reported.

## Clients, tools and performance

Proposed atoms in `packages/client-runtime/src/fork/personal-vault-agents.ts`, web status UI in `apps/web/src/fork/personal-vault-agents/`, and trusted native approval UI expose the same request lifecycle. Gate capability/version and executor readiness separately. Approve/revoke require the independent authority, not an MCP decision endpoint. Proposed tools `loom_personal_vault_agents_request`, `_inspect`, `_invoke`, `_cancel`, `_close` call the common service with authenticated caller context for all providers and scheduled agents; command jobs have no channel.

Use bounded operation subscriptions, cursor pages and deadline-boundary updates, with no idle animation or per-item polling. Personal primitives remain proposed in [the umbrella](../LOOM-PERSONAL-VAULT.md); inspect their actual interfaces at implementation time. Absence yields unsupported and does not create a dependency on another packet's internals.

## Alternatives

Reject raw password delivery, fill into agent-controlled preview, a profile as authority, or a server approval flag as isolation. Reuse the request/receipt concepts from [L85](../L85-vault-delivery/TECHNICAL.md) and [L86](../L86-vault-approvals/TECHNICAL.md) without inheriting their development-custody assumptions. Keep [L84 test accounts](../L84-vault-test-accounts/PRODUCT.md) separate from personal identities.
