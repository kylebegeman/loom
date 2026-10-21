# L111 references

## Current source and packet overlap (`36de6bbd1d`)

- `apps/server/src/fork/vault/VaultPolicy.ts:24` and `:37`: development grant attenuation/evaluation, not recipient-key custody.
- `apps/server/src/fork/vault/VaultCore.ts:104` and `:149`: server value access/reveal, unsuitable as personal share-key custody.
- `apps/server/src/fork/mcp/index.ts:32`: common tool registration with shared access checks.
- `packages/contracts/src/fork/clientRpcPermissions.ts:45`: destination environment mutation ceiling; does not establish recipient authority.
- [L81 grants](../L81-vault-grants/) and [L86 approvals](../L86-vault-approvals/): development access concepts kept separate.
- [L88 recovery](../L88-vault-recovery/) protects the development Vault; [L109 personal recovery](../L109-personal-vault-recovery/) discusses restored personal authority. Neither is an emergency-release service.
- [L102 custody](../L102-personal-vault-custody/) evaluates maintained engines; missing engine-native sharing is unsupported, not custom cryptography.
- [L107 native](../L107-personal-vault-native/) for nonexportable passkey limitations; [Personal Vault](../LOOM-PERSONAL-VAULT.md) for the proposed custody boundary and unresolved optional priorities.
- New optional brainstorm, no old Loom P/F selection or existing sharing implementation claimed.

## Official references

- [KeePass KDBX 4 format](https://keepass.info/help/kb/kdbx_4.html): actual whole-database key hierarchy/integrity; does not establish per-item recipient-key sharing.
- [KeePass synchronization](https://keepass.info/help/v2/sync.html): documented engine merge behavior, not personal sharing or emergency-release authority.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/): authenticator custody/backup properties, not a promise to export private keys.
- [NIST SP 800-57 Part 1 Rev. 5](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final): key lifecycle, compromise and recovery considerations.

Links are official reference targets, not fetched in this task. No library/code copied or dependency approved by this proposal.
