# L83 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V12** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Verified against `2f385ee835`; refresh line citations before implementation.

- [`apps/server/src/secrets/SecretRequests.ts:52`](../../../../apps/server/src/secrets/SecretRequests.ts#L52): Private secret ingress pattern.
- [`apps/server/src/fork/device-qa/DeviceQaService.ts:1`](../../../../apps/server/src/fork/device-qa/DeviceQaService.ts#L1): Existing QA service boundary; provisioning remains a separate adapter.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
