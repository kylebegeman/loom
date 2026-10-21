# L109 product

Status: Designing. Proposed scope supporting Kyle's priorities confirmed on 2026-10-21. No individual implementation selection is claimed. Parent: [Personal Vault](../LOOM-PERSONAL-VAULT.md).

## Problem

A backup on the lost server, or a recovery key stored only on the lost phone, cannot recover a personal Vault. Recovering old data must not quietly reactivate a revoked device, reuse old sessions or pretend an old policy snapshot is the latest authority.

## What the user can do

- Prepare an offline recovery kit containing the selected maintained engine's actual required factors/instructions, verify an independent open/read-back exercise, and keep it outside the development host and separately from an encrypted native backup.
- Create and verify engine-native encrypted portable exports, inspect their saved database/record version and required factors, retain independent copies, remove controlled copies, and see incomplete/obsolete backups.
- Restore into an empty isolated profile on a clean trusted device with the original server unavailable. Inspect completeness, conflicts, tombstones and data loss since the backup before choosing any cutover.
- Recover from a lost device using a surviving trusted device, or use a kit plus independent backup when every trusted device is lost. If no usable recovery material or data copy remains, show unrecoverable without inventing a bypass.
- Reconcile supported current revocations/storage authority before joining existing sync. When current state cannot be proven, recover into isolation and optionally initialize/re-key a replacement with fresh supported storage access. An old complete database may restore old data/permissions; imported grants are never automatically activated.
- Replace compromised recovery material through the engine's supported factor-change/re-key workflow, revoke supported storage/device access, and track downstream issuer-side rotation. A metadata retirement flag or device removal cannot make a copied complete database key or old backup unreadable.

## Entry points and reverse actions

Proposed Recovery and Backups settings in the trusted personal client include kit status, export/verify, recovery exercise and restore. The locked client offers Recover without requiring an environment connection. Loom settings/palette and browser extensions may launch the trusted client or inspect authorized safe status only. Recovery never asks for a code in a prompt, ordinary web form, RPC/MCP, shell snapshot or Library.

Inspect operations after restart. Cancel generation/export/restore before commitment, close views and erase temporary unwrapped material. Before deleting the last controlled backup or retiring a kit, show the resulting recovery gap. Cancelling a completed file write cannot retract an external copy. After committed engine re-key/storage cutover, close completes cleanup; the application must not reactivate old grants from a restored file. Re-enrollment follows the selected engine's supported access model; granular device revocation is unsupported where only a shared database key exists.

## States

No kit, prepared/not verified, verified, export-writing, incomplete, backup-stale, kit-replaced, recovery-in-progress, invalid-format, wrong-kit, corrupt/truncated archive, denied/cancelled secure input, storage-full, offline, locked, quarantined, authority-unknown, reconciliation-required, ready-for-cutover, cutover-complete, cleanup-needed, unrecoverable and unsupported. Show last independently opened engine backup/version and verification age separately from file creation time; neither proves current authority. Do not claim success on a download acknowledgement or a request receipt.

A kit recovers only engine backups its actual factors can open. It cannot recreate missing ciphertext, nonportable device-only credentials or lost offline edits. A valid old complete database may pass integrity while containing obsolete items/deletion state/permissions. Without independent current evidence, latest revocations remain unknown; offline data recovery does not enable sync/use authority.

## Surfaces and connection modes

| Surface                                        | Proposed acceptance and unsupported behavior                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac and iPhone personal clients                | Confirmed initial platform targets, Kyle 2026-10-21; proposed acceptance requires independently trusted kit creation, file custody, offline read-back and clean-device restore. Native lifecycle/secure file paths need inventory. |
| Safari and Chromium integrations               | Confirmed initial browsers, Kyle 2026-10-21; proposed launch/status routes into trusted personal custody; no code or archive decryption in host web content. Missing trusted integration shows unavailable.                        |
| Android, Windows and Linux                     | Explicit follow-on recovery/portability targets. Import/export and key-store guarantees must be tested before support is claimed.                                                                                                  |
| Standalone web/upstream clients                | Metadata/launch if available; otherwise explain recovery needs a supported personal client. No recovery secret entry on a development-host-served page.                                                                            |
| Local, direct remote, Tailscale, relay, tunnel | Same metadata gates; server unavailability does not prevent local kit/archive verification and data recovery. Reconnection is optional until authority reconciliation.                                                             |

## Decisions and open questions

Encryption keys and recovery codes stay independent of the development host and its full-access same-user agents. Every provider and scheduled agent uses the same service gates for metadata/outcomes only; command-only jobs remain unsupported until a suitable broker exists. Existing server Vault access never authorizes personal recovery.

[L102](../L102-personal-vault-custody/) evaluates maintained engines, KDBX 4 first candidate. Recovery uses the selected engine's native hierarchy, encrypted format and documented recovery/authority facilities; missing support means unsupported, not a custom archive/key protocol. Kyle's priorities still need to settle recovery owner(s), single-kit versus split custody, backup destinations/retention, recovery-point and recovery-time targets, acceptable fresh-identity cutover, and later-platform order. Do not assume a universal recovery code: the kit must match actual engine factors and nonportable-key limits. Social recovery or escrow require separate decisions and maintained-engine support. Independent security review precedes critical personal custody, not harmless local packet work.
