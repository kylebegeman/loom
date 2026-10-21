# L102 technical design

## Current boundary

`apps/server/src/fork/vault/VaultCore.ts:104` loads decrypted records and `:149` implements
explicit reveal. `apps/server/src/fork/vault/OpenBaoStore.ts:186` reads decrypted backend data.
`packages/contracts/src/fork/vault-core.ts:18` exposes labels/kinds/timestamps as summaries.
Those development primitives cannot hold personal master keys or private metadata.

`packages/contracts/src/fork/identity.ts:5` describes environment sign-in, not a cryptographic
personal owner. `apps/desktop/src/settings/DesktopSavedEnvironments.ts:239` decrypts saved
environment tokens using Electron safeStorage. That mechanism is not proof of resistance to
same-user full-access agents.

## Proposed shared boundary and contracts

The proposed `ext-personal-vault` separates a trusted client/custodian from an untrusted Loom
host. No personal APIs or names below exist yet. Shared schemas would live in
`packages/contracts/src/fork/personal-vault-custody.ts`; trusted-device implementations belong
in fork-owned native/client code. Missing primitives return unsupported rather than using
`VaultCore`, `SecretRequests` or a personal token file on the server.

Proposed non-secret status includes protocol version, supported operations, coarse lock state,
opaque owner/Vault/device handles and typed failure reasons. Independently trusted local
operations cover create, unlock, lock, inspect/cancel operation, begin/inspect/cancel admission,
revoke device and begin/inspect/cancel recovery. Raw factors, recovery codes and decrypted
items have no Loom RPC, MCP or prompt representation. If any non-secret environment RPC is
added, use `loom.personal-vault-custody.*`, bounded responses, guarded scopes and
`EnvironmentAuthorizationError`; its grant conveys no owner authority.

## Engine, format and keys

Evaluate an established engine with published format, authenticated integrity, supported
platform bindings, maintenance history, test vectors and compatible recovery tooling. KDBX 4
is the first proposed candidate, not an approval to add a package. Record engine version,
license, native bindings, upgrade/rollback behavior and an independent restore result before
selection. Do not derive a new format by combining familiar algorithms.

The decision must name the actual hierarchy: password input/composite key, engine KDF and
parameters, database encryption key derivation, per-file seeds, authenticated metadata and
attachment treatment. For KDBX 4, follow its composite-key/KDF/master-seed construction;
do not describe an invented wrapped per-item key scheme as KDBX. A hardware/device unlock
adapter must document exactly which equivalent unlock material it protects and when it can
release it. Recovery must be sufficient to reopen the actual engine format, not just the
Loom account. Re-key/password changes use engine operations with crash-safe replacement.

Encrypt titles, domains, usernames, tags, notes, favorites and history as well as passwords.
Expose only the minimum opaque routing/version envelope needed for storage. Document residual
size/timing leakage. Personal ciphertext storage is separate from development records; no
new server plaintext tables or migration of existing Vault items is implied.

## Isolation and owner identity

Bind a generated cryptographic owner identity to a local trusted-client setup; record the
relationship to a Loom login without treating that login, profile selection or host enrollment
as key authority. Admission binds the new device's verified public identity to the owner and
Vault, with short-lived nonces, explicit presence, replay rejection and cancellable receipts.
Revoke trust monotonically and reconcile stale devices before accepting new writes.

The proposed safe baseline keeps custody and personal browser sessions outside the agent's
OS principal/device. A signed hardened helper, keychain access control and authenticated IPC
may be part of a reviewed alternative, but are not isolation proof alone. Test arbitrary
same-user code, binary replacement, debugger/inspection, local channel impersonation, browser
remote debugging, accessibility/UI automation, crash dumps and readable storage. If any can
obtain a key or approved plaintext without the owner action, that topology is unsupported.
An administrator/root compromise is a separately documented limit, not a reason to ignore
ordinary full-access same-user code.

## Lifecycle, recovery and performance

Lock invalidates local operation capabilities, pending presence prompts, plaintext caches and
search indexes. Late callbacks cannot re-unlock after lock/revoke. Best-effort memory clearing
is not a claim about managed-runtime zeroization. Keep keys out of the Loom JS heap.

Bootstrap recovery locally, verify it on isolated encrypted fixtures and retain a versioned
authenticated recovery description. Restore first into a new location; inspect before
promotion. Cancel leaves current state intact. Recovering stale backups cannot silently
resurrect revoked device trust. Device revocation cannot erase copies or revoke a website
credential already disclosed; surface the corresponding rotation/recovery work.

Use bounded native status notifications and measured KDF work on supported devices. No
per-keystroke server RPC, continuous lock countdown or background plaintext index.

## Agent and overlap boundaries

All providers, including Codex, Claude, Cursor, Grok, OpenCode and Antigravity, can receive only
common non-secret service/MCP capability state if exposed. Scheduled agent runs use the same
gates; command-only jobs are unsupported without an explicit broker. No adapter gets a
special unlock bypass. [L79](../L79-vault-core/) and [L80](../L80-vault-brokers/) retain
server/development custody; [L81](../L81-vault-grants/) grants cannot decrypt this Vault.
[L88](../L88-vault-recovery/) concerns development backups. [L109](../L109-personal-vault-recovery/) extends recovery-kit/backup exercises; this packet
retains the minimum clean-device bootstrap needed for custody. [L108](../L108-personal-vault-sync/)
covers richer sync/offline conflicts. Consume shared primitives when implemented, with
unsupported states otherwise, not packet dependencies.
