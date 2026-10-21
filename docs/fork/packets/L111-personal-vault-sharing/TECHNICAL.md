# L111 technical design

Proposed optional work at source baseline `36de6bbd1d`. All new paths, schemas and method names below are proposed. No personal share/release API exists by implication from development Vault.

## Existing boundary and engine dependency

`apps/server/src/fork/vault/VaultPolicy.ts:24` attenuates development grants and `:37` evaluates them; these are server-readable access controls, not recipient-key encryption. `apps/server/src/fork/vault/VaultCore.ts:104` reads values and `:149` reveals them. Do not store personal share keys there. [L81](../L81-vault-grants/) and [L86](../L86-vault-approvals/) cannot become independent personal authority through a UI label.

[L102 custody](../L102-personal-vault-custody/TECHNICAL.md) evaluates maintained engines/formats, with KDBX 4 as the first candidate. Sharing must use the selected engine's native key hierarchy, authenticated formats, recipient authorization and export/revocation behavior. This packet does not introduce a new envelope crypto format, key-wrapping hierarchy, signature chain or synchronization protocol.

| Engine alternative                        | What can be proposed                                                                                                                            | Honest unavailable state                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole-database/KDBX-compatible engine     | Use its documented separate-database/export facilities for isolated fixture copies and its own integrity/merge rules.                           | An ordinary shared KDBX file/password is not verified recipient-public-key sharing or enforceable expiry. Do not advertise this packet unless a maintained interoperable integration actually provides the requested item/recipient semantics. Never release the primary database key to share one item. |
| Maintained client-encrypted record engine | Use its documented per-item recipient-key sharing, key verification, version/update policy and revocation mechanisms if independently verified. | Missing item-level recipient scope, native client support, future-recipient exclusion or recovery semantics disables the corresponding action; do not fill gaps with home-grown crypto.                                                                                                                  |

A separate maintained sharing engine/integration is a possible later decision if the main engine lacks these features; it requires explicit compatibility/custody review, not a hidden dependency or a reason to replace personal storage now. Ordinary sharing stays optional beyond daily use.

## Verified recipient and selected item

An independently trusted client verifies the recipient key through an independent fingerprint/QR comparison using the engine's supported identity model. A host-controlled directory can suggest a recipient but cannot authenticate a new key. Key change, additional recipient device and restored identity follow the engine's real verification/recovery rules; no matching name silently substitutes for proof.

Request exactly one selected item/version and fields through the engine's supported sharing operation. Review automatic updates separately; default proposal is a snapshot and no later updates. Validate engine binding of sender, recipient, item/version and selected fields with concrete negative tests. If the engine cannot enforce a narrower selection, show that limitation and disable sharing at the requested scope. Reject attempts to approximate per-item sharing by handing out a whole-database key.

Revoke/expiry stops new delivery only to the extent the engine actually enforces it. Use engine-native rekey/removal operations where supported; copied plaintext, keys and old snapshots can remain decryptable. Recipient acknowledgements prove acceptance/delivery, not deletion. Upstream credential/session invalidation is a separate confirmed operation. Nonexportable platform passkey private keys stay unavailable for sharing; importing a label does not create an exportable credential.

## Emergency waiting and release

Evaluate emergency access as an engine capability, not a timer layered over decryptable ciphertext. A recipient who already holds an engine-decryptable backup or share can decrypt it immediately; a server countdown cannot enforce waiting. A development host holding release/decryption material violates personal custody.

Proposed first fixture mode is owner-device-mediated review/release after a wait, using ordinary supported sharing on an independently trusted device. The wait is a workflow policy, not a novel cryptographic time lock. Verify the actual independent approval primitive, current policy/cancellation and trustworthy time immediately before release; missing freshness or owner device means release unavailable. A host clock, old approved request or notification cannot establish authority.

Truly unattended release after owner/device loss remains optional and unavailable unless a maintained engine/service provides a reviewed independently trusted custodian/quorum model, cancellation/freshness guarantees and recoverable policy. Document the exact external trust and availability cost before selection. Do not pre-deliver a decryptable envelope and call it protected by waiting, or invent a custom split-key protocol to satisfy the ambition.

Lifecycle receipts use opaque operation IDs for idempotent coordination, not personal key authority. Cancel/release races must serialize at the actual trusted executor supported by the engine. Unknown results are inspected by existing operation/engine receipt before another release. After confirmed release, cancel can stop future updates but cannot recall data.

## Recovery and storage

Engine-native encrypted local state includes recipient verification, policies, delivery/revocation evidence and any supported emergency configuration. Restoring a complete old database may restore stale share settings or keys; authenticated file integrity alone does not prove freshness. Restore data into quarantine, compare available current trusted device/engine state and reauthorize future releases. Where the engine cannot prove latest revocations, leave sharing disabled or create a separately reviewed fresh identity/database; do not claim a cryptographic revocation frontier. [L109](../L109-personal-vault-recovery/) carries the same engine-dependent constraint, without a packet implementation dependency.

Relay storage contains only engine-native encrypted blobs plus minimum opaque routing/receipt metadata. Declare relationship, size and timing leakage. Do not persist account names, plaintext item scopes, secrets or recovery material in host logs, shell snapshots or Library. Retention/cleanup respects actual engine support; removal of undelivered ciphertext is different from deleting a recipient's copy. No additional database format is selected here.

## Proposed contracts, clients and tools

Proposed `packages/contracts/src/fork/personal-vault-sharing.ts` models engine/protocol capability versions, opaque delivery IDs and status/cancel. Optional nonstreaming `loom.personal-vault-sharing.status`, `.cancel` and `.deliver` carry expected coordination revision and opaque engine-native ciphertext. Bounded inspect pages expose delivery state only. Exact schemas must follow the selected engine; this naming is not a finished common API. Errors include `EnvironmentAuthorizationError` and unsupported/denied/locked/conflict/stale-authority/unavailable/unknown. Use the fork permission map, `createEnvironmentRpcCommand` and `permissionAtom`; environment permission is an outer ceiling, never recipient/release authority.

Proposed metadata service: `apps/server/src/fork/personal-vault-sharing/`; atoms: `packages/client-runtime/src/fork/personal-vault-sharing.ts`; web/mobile setup/status UI: their `src/fork/personal-vault-sharing/` folders. Key verification, decrypt/reveal and release occur only in independently trusted clients through actual engine primitives. An unrestricted same-user agent must not drive private UI, inspect keys or impersonate its IPC. Missing custody/platform support means unavailable.

Optional proposed common MCP status/cancel tools expose only explicitly authorized operation state to every provider and scheduled agent. No recipient enrollment, verify-key, release, raw-value or decrypt tool. Command-only jobs remain unsupported without an explicit broker. Gate engine capability/version, independent custody and platform separately. No imports from other packet internals or assumed implementation order.

## Performance and rejected alternatives

Use engine-native size limits/transfer behavior with bounded transport pages and recipient counts. Inspect only active operations, update waits at meaningful boundaries and avoid continuous polling/animation. Reject bearer links as recipient authentication, server-held personal keys, invented mandatory per-item wraps on a whole-database engine, silent directory-key substitution and copied-secret revocation claims. Independent security review precedes critical personal sharing/emergency adoption.
