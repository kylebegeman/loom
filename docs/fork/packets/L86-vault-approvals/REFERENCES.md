# L86 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V14** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Milestone starts from `b0cfe6a63f`.

- [`apps/server/src/secrets/SecretRequests.ts:52`](../../../../apps/server/src/secrets/SecretRequests.ts#L52): Existing request lifecycle pattern.
- [`apps/desktop/src/ssh/DesktopSshPasswordPrompts.ts:280`](../../../../apps/desktop/src/ssh/DesktopSshPasswordPrompts.ts#L280): Current SSH prompts depend on a desktop window.
- [`apps/server/src/orchestration-v2/Orchestrator.ts:1`](../../../../apps/server/src/orchestration-v2/Orchestrator.ts#L1): Pure orchestration cannot perform approval I/O.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.

- [Access service](../../../../apps/server/src/fork/vault/VaultAccess.ts): same-policy atomic decisions.
- [Grant evaluator](../../../../apps/server/src/fork/vault/VaultPolicy.ts): normal execution enforcement.
- [Access contracts](../../../../packages/contracts/src/fork/vault-access.ts): request lifecycle and bounded grants.
- [Notification adapter](../../../../apps/server/src/fork/vault/ApprovalNotifications.ts): explicit runtime stub.
- [MCP boundary](../../../../apps/server/src/fork/vault/access-mcp.ts): authenticated requests without self-approval.
- [Service acceptance](../../../../apps/server/src/fork/vault/VaultAccess.test.ts): expiry, races and failures.

- Requester identity, cancellation, run binding and retention use the same
  [access service](../../../../apps/server/src/fork/vault/VaultAccess.ts) and
  [MCP boundary](../../../../apps/server/src/fork/vault/access-mcp.ts); no resumable command payload is stored.

Local explicit-retry acceptance composes the existing services in
[`VaultApprovalRetry.test.ts`](../../../../apps/server/src/fork/vault/VaultApprovalRetry.test.ts)
and [`VaultGitHub.test.ts`](../../../../apps/server/src/fork/vault/VaultGitHub.test.ts).
Native acceptance evidence is indexed in [TESTING.md](./TESTING.md).

- [Internal operation journal](../../../../apps/server/src/fork/vault/OperationJournal.ts): independent CAS state, requester-safe read-only recovery and closed execution gates.
- [Journal crash acceptance](../../../../apps/server/src/fork/vault/OperationJournal.test.ts): lost replies, races, corruption and retention.
- [Isolated policy/restart proof](../../../../apps/server/src/fork/vault/testkit/journal_proof.py): scoped synthetic OpenBao only.

- [Profile cleanup regression](../../../../apps/server/src/fork/vault/VaultProfiles.test.ts): reserved journal and sibling-project isolation during retirement.

- [Dispatcher design proof](../../../../apps/server/src/fork/vault/OperationDispatch.proof.test.ts): synthetic interleavings plus real reserve-replay and timed-grant counterexamples; no runtime dispatcher.

- [Fresh acquisition service races](../../../../apps/server/src/fork/vault/OperationAcquisition.test.ts): acknowledged CAS, replay, interruption, single-use validation and handle isolation with no dispatch.

- [Internal adapter admission](../../../../apps/server/src/fork/vault/OperationAdmission.ts) and [synthetic adapter acceptance](../../../../apps/server/src/fork/vault/OperationAdmission.test.ts): metadata-only checks, fresh revalidation and closed gates; no live dispatch.

- [One-time intent counterexamples](../../../../apps/server/src/fork/vault/OperationIntent.proof.test.ts): current evaluator bypasses, actual format-3 reader/writer behavior and a design-only eligibility model. No persisted intent or gate change.

- [Synthetic token-mint failure coverage](../../../../apps/server/src/fork/vault/GitHubTransport.test.ts) and [explicit SSH/Git retry recovery](../../../../apps/server/src/fork/vault/VaultApprovalRetry.test.ts): adapter-start effects and uncertain outcomes without live providers.
