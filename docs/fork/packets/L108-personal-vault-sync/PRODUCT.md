# L108 product

Status: Designing. Proposed scope; Kyle's priority answers are pending. No individual implementation selection is claimed. Parent: [Personal Vault](../LOOM-PERSONAL-VAULT.md).

## Problem

A personal Vault should remain useful when a phone has no network or the development server is down. A compromised development host or full-access same-user agent must not acquire personal decryption authority from a server session, cached files or an unattended OS credential API.

## What the user can do

- Unlock an encrypted cache in an independently trusted personal client, inspect its last verified engine database/record version and use supported cached items offline.
- Make offline edits and see what is saved locally, waiting to sync, rejected or conflicted. Preserve whole-database conflict copies or the maintained record engine's native conflict state. Review secret conflicts; do not silently choose a password by file timestamp.
- Delete an item and inspect engine-native deletion/tombstone state. An old complete database may still contain it: preserve that copy for trusted reconciliation rather than automatically republishing it. Show unsupported automatic deletion reconciliation when the selected engine cannot prevent unintended reappearance.
- Pair a device by verifying the same Vault identity and pairing challenge on trusted surfaces; inspect devices, cancel an invitation and revoke a device.
- Use engine-native key change/rotation and supported device/storage revoke, inspect progress and recover interrupted work. A removed device cannot be made to forget a complete database key or copied data; protection of future files requires supported re-key and storage/session cutover.
- Pause/resume sync, lock immediately, close an operation, remove a local cache and open [personal recovery](../L109-personal-vault-recovery/). Cache removal explains unsynced loss before deletion.

## Entry points and reverse actions

The proposed personal client has Sync and Devices settings, cache status on its locked/unlocked view, and a recovery link. Loom settings and palette may open that trusted client or display safe status; they never collect unlock material. Any shortcut uses the same gates. No new shortcut is assumed.

Inspect operation receipts after reconnect. Cancel pairing before admission; close clears its ephemeral state. Cancel sync stops unsent work but cannot undo accepted file/record writes. Pause preserves engine-encrypted local work; resume rechecks supported storage/device access. Re-pair uses the engine's supported workflow. Re-key may cancel before commit; after commit, inspect the actual engine outcome and repair forward without automatic old-key fallback. Lock and close clear decrypted views and pending pairing state.

## States

Loading, no cache, locked, unlocked, offline, syncing, paused, quota/storage-full, conflict, deletion-pending, rotation-pending, pairing/expired, device-revoked, stale-authority, clock-uncertain, rollback-suspected, recovery-required, denied and unsupported. Show the last verified engine file/record version separately from the last network attempt; integrity alone does not establish freshness. A relay acknowledgement is not proof all devices applied a change.

Offline revocation has limits: a disconnected device may still read a complete database using a copied key. A local unlock deadline is policy, not expiry of that key. Clock rollback or restart without trustworthy elapsed-time evidence must not extend an enforceable deadline. A valid old complete database can contain old data/permissions; where current authority cannot be proven, show uncertainty and disable automatic reconciliation or restricted use.

## Surfaces and connection modes

| Surface                                        | Proposed acceptance and unsupported behavior                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac personal client plus iPhone                | Provisional first pair; offline unlock/cache/sync/device lifecycle require independently trusted custody. Unsupported custody disables personal unlock, not ordinary development Vault. |
| Safari and Chromium                            | Provisional browser integrations, only in separately installed trusted extensions/companions. Host web content never holds the root key; missing integration shows unavailable.         |
| Android, Windows and Linux                     | Full follow-on targets; capability inventory and tests required before claiming support. Show unavailable with a supported-device route.                                                |
| Standalone web/upstream T3 client              | Safe status/launch when available; no personal unlock in host-served JavaScript. No capability means unavailable, with ordinary T3 workflows intact.                                    |
| Local, direct remote, Tailscale, relay, tunnel | Same encrypted relay semantics. Switching environments never switches or enrolls the personal Vault silently.                                                                           |

## Decisions and open questions

[L102](../L102-personal-vault-custody/) evaluates maintained engines/formats, KDBX 4 first candidate. The design must choose between whole-database sync with engine conflict-copy/merge rules and a maintained client-encrypted record engine, using its actual key hierarchy, integrity, deletion and revocation capabilities. Missing primitives mean unsupported, not a custom replacement. The server is an untrusted ciphertext relay for personal data. Existing OpenBao records are a separate development Vault. Library, prompts, shell snapshots, RPC/MCP and provider tools never receive raw personal secrets. Agents and scheduled agents get authorized metadata/outcomes only through the same service gates; command-only jobs are unsupported until a suitable broker exists.

Kyle still needs to prioritize platforms, offline duration/read-write policy, conflict history/deleted-item retention, supported cache sizes, and who may administer device membership. Selected-engine integration and custody require independent security review before critical personal custody. That review is not a gate for harmless local design or synthetic tests.
