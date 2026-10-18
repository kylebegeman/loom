# L85 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for documentation on 2026-10-17. This packet is
**V14** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/secrets/SecretRequests.ts:52`](../../../../apps/server/src/secrets/SecretRequests.ts#L52): Existing request lifecycle pattern.
- [`apps/desktop/src/ssh/DesktopSshPasswordPrompts.ts:280`](../../../../apps/desktop/src/ssh/DesktopSshPasswordPrompts.ts#L280): Current SSH prompts depend on a desktop window.
- [`apps/server/src/orchestration-v2/Orchestrator.ts:1`](../../../../apps/server/src/orchestration-v2/Orchestrator.ts#L1): Pure orchestration cannot perform approval I/O.

## Shared design and prior art

- [Foundation proposal](../LOOM-VAULT-FOUNDATION.md): shared contracts and candidate backend evaluation.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied, and no backend/license/dependency has been selected by this packet.
