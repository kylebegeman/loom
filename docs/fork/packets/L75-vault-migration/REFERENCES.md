# L75 references

Kyle selected V03 and the complete sixteen-item Vault scope for implementation. The initial
reviewed import was developed against fork main `f7cd2e14d1`.

- [Contracts](../../../../packages/contracts/src/fork/vault-migration.ts): explicit confirmations,
  redacted private ingress and safe result states.
- [Migration service](../../../../apps/server/src/fork/vault/VaultMigration.ts): encrypted plan
  binding and receipts over the existing [VaultCore](../../../../apps/server/src/fork/vault/VaultCore.ts).
- [GitHubHostSetup](../../../../apps/server/src/sourceControl/GitHubHostSetup.ts): existing HTTPS
  setup; no automatic SSH remote migration is added here.
- [Inventory adapter](../../../../apps/server/src/fork/vault/MigrationGitMetadata.ts) and
  [replacement service](../../../../apps/server/src/fork/vault/VaultMigrationInventory.ts): bounded
  local reads, sanitized hints, reviewed intent and scoped receipts, without config writers.
- [SSH service](../../../../apps/server/src/fork/vault/VaultSsh.ts) and
  [transport](../../../../apps/server/src/fork/vault/SshTransport.ts): exact, isolated repository
  read verification; [GitHub connection](../../../../apps/server/src/fork/vault/VaultGitHub.ts)
  owns scoped API verification and cleanup.
- [Inventory contracts](../../../../packages/contracts/src/fork/vault-migration-inventory.ts):
  literal verification/cutover limits and destination-scoped commands.
- [User help](../../user/vault.md#import-development-records): starting the reviewed import.
- [Operating policy](../../operations/vault.md#development-import-operating-policy): host-owner handoff.
- [Foundation](../LOOM-VAULT-FOUNDATION.md), [extension points](../EXTENSION-POINTS.md), and
  [shared design gates](../LOOM-VAULT.md#design-decisions-before-building): cross-packet constraints.

Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0). This slice adds no external code, application
dependency, Library deployment or SQL migration. Personal password managers remain separate.
