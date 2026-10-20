# L84 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V12** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Original design baseline `2f385ee835`; first local implementation starts from `4070ef99a2`.

- [`apps/server/src/secrets/SecretRequests.ts:52`](../../../../apps/server/src/secrets/SecretRequests.ts#L52): Private secret ingress pattern.
- [`apps/server/src/fork/device-qa/DeviceQaService.ts:1`](../../../../apps/server/src/fork/device-qa/DeviceQaService.ts#L1): Existing QA service boundary; provisioning remains a separate adapter.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.

- [Account pool contracts](../../../../packages/contracts/src/fork/vault-test-accounts.ts), [service](../../../../apps/server/src/fork/vault/VaultTestAccounts.ts) and [behavior tests](../../../../apps/server/src/fork/vault/VaultTestAccounts.test.ts): reference-only encrypted registry and atomic reservation lifecycle.
- [Real backend proof](../../../../apps/server/src/fork/vault/testkit/test_accounts_proof.py) and [integration tests](../../../../apps/server/src/fork/vault/VaultTestAccounts.integration.test.ts): existing scoped policy and backend restart.
- [Shared expiry/actions](../../../../packages/client-runtime/src/fork/vault-test-accounts.ts), [web manager](../../../../apps/web/src/fork/vault/TestAccountSettingsSection.tsx) and [mobile manager](../../../../apps/mobile/src/fork/vault/TestAccountSettingsSection.tsx): metadata-only management.

- [Authenticated workload boundary](../../../../apps/server/src/fork/vault/VaultTestAccountWorkloads.ts), [behavior proof](../../../../apps/server/src/fork/vault/VaultTestAccountWorkloads.test.ts) and [agent transport](../../../../apps/server/src/fork/vault/test-accounts-mcp.ts): run identity, inspect/use ceilings and durable quarantine without login delivery.

- [Local Loom target harness](../../../../apps/server/src/fork/vault/testkit/loom_test_instance.py)
  and [isolation/failure tests](../../../../apps/server/src/fork/vault/testkit/test_loom_test_instance.py):
  operator-only real session provision/revoke/replacement proof; no live pool login adapter.
- [Session CLI](../../../../apps/server/src/cli/auth.ts),
  [fixture seeder](../../../../apps/server/scripts/seed-dev-db.ts) and
  [HTTP contracts](../../../../packages/contracts/src/environmentHttp.ts): existing Loom identity paths.
- [Local setup and Migadu handoff](../../operations/vault.md#isolated-loom-account-test-target):
  chosen target/provider and the remaining mailbox-owner setup.

- [Gated Migadu inbox contract](../../../../apps/server/src/fork/vault/testkit/migadu_inbox.py),
  [message/failure cases](../../../../apps/server/src/fork/vault/testkit/test_migadu_inbox.py) and
  [loopback IMAP/TLS proof](../../../../apps/server/src/fork/vault/testkit/test_migadu_imap.py):
  synthetic read-only provider proof with no live default or credential ingress.
- [Migadu IMAP settings](https://www.migadu.com/support/) and
  [plus-folder routing](https://www.migadu.com/guides/plus_addressing/): fixed verified destination
  and default per-tag folders. [Python IMAP documentation](https://docs.python.org/3/library/imaplib.html)
  and installed stdlib source define EXAMINE, PEEK, UID responses and verified TLS configuration.
