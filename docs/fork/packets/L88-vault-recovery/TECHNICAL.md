# L88 technical design

The offline archive boundary below is implemented. Backend automation, production custody
and trust promotion remain target contracts requiring the recorded owner decisions.
Read the [foundation proposal](../LOOM-VAULT-FOUNDATION.md) for identity, storage, delivery,
permission ceilings and retry semantics; these constraints are not reimplemented per packet.

## Implemented offline archive boundary

`RecoveryArchive.ts` owns the local POSIX adapter; `recovery-cli.ts` is a thin caller through
the existing fork CLI registry. There is no RPC, MCP, browser download or backend token use.
Windows returns an explicit refusal until an equivalent owner-restricted filesystem boundary
is implemented. These commands require no OpenBao path, policy or record-format change.

Archive version 1 is `LOOMVAULT1\n`, a random 32-byte salt and a random 12-byte nonce,
followed by AES-256-GCM ciphertext and a 16-byte authentication tag. The random 32-byte key is
stored separately; HKDF-SHA256 with context `Loom Vault recovery archive v1` derives each
archive key. The complete header is authenticated associated data. Encrypted content starts
with a four-byte big-endian JSON-manifest length (1 to 4096 bytes), then that manifest and the
snapshot bytes. The manifest records version, environment identity, creation time, safe-integer
positive snapshot size and SHA-256. Unknown versions, wrong environments, malformed manifests,
truncation, extra bytes, digest mismatches and authentication failures refuse.

The source is an opaque operator-supplied file, not an asserted valid OpenBao snapshot.
Encryption hashes it before and during streaming and refuses changed content. Verification
streams authentication without publishing plaintext. Recovery streams into an owner-only
staging file, fsyncs it and publishes using an exclusive hard link only after full authentication.
The parent directory is fsynced. Existing paths, including symlinks, cannot be overwritten.
Interruption aborts streaming and waits for the operation promise, including its async cleanup,
before the CLI exits. Output requires local hard-link and directory-fsync support; unsupported
exclusive-link publication returns a specific refusal with no fallback. Copy completed encrypted
archives to removable/network media separately. Abrupt process/host loss can leave private staging
files, so use encrypted local storage and inspect interrupted work before retrying. A late I/O
failure can follow publication; callers must inspect the destination rather than assume retry
is safe. Inputs use nonblocking no-follow opens followed by regular-file checks; a FIFO cannot hold
the process waiting for a writer. Key reads are bounded to 33 bytes even if the file grows
after stat. Keys and plaintext sources must be owner-only.

Successful receipts explicitly retain `backendRestoreVerified: false` and `canPromote: false`.
An isolated restore exercise, not this receipt, proves a backend can read a particular snapshot.
The exercise also demonstrates that a token revoked after capture reappears on restore, then
explicitly revokes it. It never connects a restored backend to workloads. No claim is made that
archives solve missing post-snapshot revocation history. Old runtimes ignore the standalone
archive files, but cannot read them; keep a compatible CLI and backend binary with the recovery
procedure. Access-policy format 3, operation journal 1 and all execution gates are unchanged.

## Overview

Create encrypted consistent backups covering payloads, metadata and required policy state. Keep recovery material separately managed. Restore into an isolated destination, verify decryption and policy integrity, then explicitly promote it with old-machine trust reviewed or invalidated.

## Contracts and authorization

Backup/create/status/export and restore/inspect/verify/promote are distinct operations. Recovery cannot silently revive expired or revoked identities from an older snapshot. Human exports are explicit, audited sensitive actions, not general agent tools.

Use packet-owned `loom.vault-recovery.*` RPC methods if Loom transport is needed; exact schemas
remain a design-review output. Return typed unsupported, locked, denied, conflict, expired,
unavailable and operation-failed outcomes as appropriate, including environment authorization
errors. Register protected methods in the fork permission map and use environment RPC commands.
Metadata visibility, item management and credential use are distinct rights.

## Server and storage

Implement services in fork-owned paths and keep HTTP/RPC/MCP handlers thin. All credential
access goes through the shared backend/broker adapter; the feature never reads a personal
password manager as a fallback.

Version backup formats and integrity manifests; encrypt payloads and sensitive metadata. Define retention, off-host destination and deletion propagation. Recovery keys are not included beside their encrypted backup by default. Record restore provenance without secret contents.

## Clients and agent-facing tools

Place shared client state in client-runtime and surface it through web, desktop and mobile.
Gate on advertised Vault capability/version; disable unsupported operations without disabling
ordinary T3 behavior. Agent tools use `loom_vault_recovery_*` names if exposed and
return safe summaries or operation handles. An agent cannot approve its own access, export raw
values by default or widen the caller's existing T3 permissions.

## Performance and failure handling

Use bounded pages and operation-scoped updates. Never subscribe to secret payloads, poll every
item continuously or repaint an idle UI. Reconnect by operation ID and persisted revision;
mutation retries use stable idempotency keys. External effects run after durable acceptance and
reconcile partial completion. Evidence tests await receipts or Deferreds, not sleeps.

## Alternatives and integration review

Use backend export interfaces and fork CLI/UI registration. Do not fold Vault recovery into the upstream SQLite doctor command without an explicit reviewed integration.

Prefer existing registries over new upstream seams. A direct provider-specific secret path
would duplicate policy and is not the recommended design. Where the shared interface is absent,
report unavailable or implement the approved minimal extension independently; do not import
another packet's UI/service internals.
