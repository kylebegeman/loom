# L78 technical design

Kyle selected OpenBao, not Loom-native cryptography. The active encrypted-record interface is
specified in [ext-vault](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault). The complete
control-plane target remains in [the foundation](../LOOM-VAULT-FOUNDATION.md).

## Implemented data and concurrency boundaries

The server derives a namespace from SHA-256 of its persisted environment ID. Callers cannot
choose another environment's backend path. Each item is one KV v2 record containing versioned
payload, metadata and the most recent mutation receipt. CAS writes commit them atomically;
expectedVersion 0 creates and positive versions replace. Stable operation IDs and request/actor
fingerprints make retries idempotent. Reusing an ID for different input conflicts. A subsequent
mutation supersedes the previous receipt; this is not yet a permanent operation/audit ledger.

Renaming can omit value. Kind changes require explicit value replacement. Archive retains the
value and forbids replacement until restored. Delete writes a tombstone and clears the current
value; encrypted prior versions remain until backend retention destroys them. Deletion does
not claim provider-side revocation or secure erasure of backups.

Values are redacted internally and encoded only across the protected transport/backend
boundary. Secret-bearing OpenBao writes use streaming request bodies whose inspection does not
show payloads. Errors normalize backend failures without echoing response bodies. Metadata
pages read at most 25 records, with concurrency 4; key enumeration is capped at 4096 entries.
Values are capped at 1 MiB; client file import is capped at 512 KiB before base64 encoding.

## OpenBao payload encoding compatibility

OpenBao's default JSON complexity budget counts strings, including repeated object keys.
Bounded policy/registry audit arrays can exceed that count even at modest byte sizes. The
adapter therefore writes KV data as `{loomVaultEncoding:"json-v1",payload:<serialized JSON>}`.
This keeps engine-side JSON simple without raising limits or reducing history. The application
still validates the decoded domain records, bounds bytes, redacts values and uses the same
paths/CAS versions. Unknown or malformed encoding envelopes fail closed.

Reads accept existing unwrapped records. The next normal mutation writes the versioned encoding;
no live conversion or eager migration is performed. Older Loom readers cannot interpret newly
encoded records. Rollback requires a compatible reader or a matching pre-upgrade backend
snapshot, with the usual revocation reconciliation. Encrypted persistence and clean restore
are verified with the new encoding against disposable OpenBao 2.7.1.

## Authorization and private ingress

Authenticated environment access:read permits status/list. Access:write permits save, lifecycle
changes and explicit human reveal. Web/mobile commands use the shared permission boundary;
server RPC authorization remains authoritative. This initial management model is coarser than
the complete inspect/manage/use/reveal/export grant model selected in L80.

MCP status is safe metadata. Item listing, storage and lifecycle changes currently require the
existing full-access/default environment-caller ceiling. Private storage additionally requires
an authenticated T3 thread. `VaultPrivateInput` obtains the thread's project from ThreadManagement,
checks current permission, checks for a committed receipt, then transfers the private source.
The transfer claim hashes request, backend origin/mount and server environment, preventing a
retry from silently delivering to another destination. Permission is checked again immediately
before persistence. There is no raw-value MCP tool or CLI reveal command.

`SecretRequests.transfer` durably claims a ref before calling an idempotent destination. Failure
retains the source only for that operation; cleanup failure retains the claim. A matching Vault
receipt returns the committed result even after source consumption or a lost response. Existing
SecretRequests storage is owner-only plaintext, and this work does not convert upstream auth
storage into an encrypted vault.

## Connection and custody

The operator configures an OpenBao origin, a private token file and KV v2 mount. Tokens are
re-read on each request, enabling file rotation. Origins must be HTTPS, except loopback HTTP for
isolated tests. Redirects, URL credentials, paths, queries and fragments are rejected. Requests
and bodies have timeouts; response size is bounded. Status distinguishes unconfigured,
misconfigured, ready, locked, denied and unavailable. It checks health plus KV v2 configuration,
not the token's ability to perform every later item operation.

The service token is not the encryption key. OpenBao owns encryption and unseal; the isolated
proof uses Raft on OpenBao 2.7.1, MPL 2.0. Production unseal/recovery custody, platform owner
mapping and service identity provisioning remain decisions. New remote use is online-only;
there is no offline decrypted cache. Same-user full-access agents may read local service
credentials or memory, so this design does not claim OS-level agent isolation.

## Integration and remaining work

Shared Effect services live under `apps/server/src/fork/vault/`, registered once through
ForkLayer/ForkRuntime. RPC/MCP/CLI adapters are thin. Client-runtime commands serve web/desktop
and native mobile; capability checks hide controls on unsupported servers. No provider launcher,
SSH agent, live platform API or personal credential source is modified.

The existing begam.in platform and Helios were inspected read-only. Their identity/deployment
contracts remain the integration direction; no separate parallel login or deployment stack is
introduced. Backend service tokens must not become the permanent Loom account model.
