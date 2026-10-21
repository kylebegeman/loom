# L111 implementation plan

## Starting condition

Optional scope beyond first personal daily use. Read [Personal Vault](../LOOM-PERSONAL-VAULT.md); do not treat these proposals as Kyle selecting family sharing or emergency deployment. No live recipients, messages, personal imports or account changes are part of fixture work.

## Ordered steps

1. Specify ordinary sharing with one synthetic item/version and two independently trusted fixture clients. Define recipient verification, fields, update policy and the copied-secret limitation in user terms. Keep full-vault sharing out of the default.
2. Inspect real personal encryption/device/authority interfaces. Reuse only implemented versioned primitives; otherwise implement a minimal fixture boundary through shared ownership or show unavailable. Do not create circular recovery/sharing dependencies or inherit development server custody.
3. Evaluate the engine selected through L102: whole-database/KDBX compatibility does not provide recipient-key item sharing by itself. Use only a maintained engine/integration with documented sharing semantics, key hierarchy, format and recovery. Missing features remain unavailable; do not add custom crypto. Any new production dependency requires applicable authorization. Test recipient/item/version substitution against real engine behavior.
4. Implement independently verified enrollment, encrypted invitation/accept/decline and delivery receipts. Add local inspect/remove, sender cancel/revoke/expire, engine-native recipient-key re-verification and explicit future-update enrollment. Encrypt private metadata as well as values.
5. Add bounded ciphertext relay/status contracts and optional common MCP status/cancel tools. Server permission is a separate ceiling; no provider or scheduled agent may verify recipients, release, decrypt or widen sharing. Command-only jobs remain unsupported.
6. Add restart/recovery reconciliation against the engine's actual current identity, deletion and recipient-revocation state before any new envelope can be issued. Demonstrate that expiry stops future delivery but does not falsely claim to erase a previously decrypted copy.
7. Prototype owner-device-mediated emergency waiting with synthetic clocks and identities. Race cancel against release at the trusted authority. Missing trusted release device/state shows unavailable. Leave unattended lost-owner release proposed unless a maintained engine/service provides independently reviewed custodian/quorum and recovery/cancellation semantics.
8. Test provisional Mac+iPhone flow and Safari/Chromium compatibility only through authorized primary-agent verification. Track Android/Windows/Linux/web independently. Add actual seam inventory and concise user guidance; independent security review precedes critical sharing/emergency custody.

## Done when

Only verified recipients decrypt selected snapshots; substitution/replay and server rollback cannot create new authority; all invitation/share/request actions are inspectable and reversible for future delivery. Copied data and already committed releases have truthful limits. Emergency availability and trust are stated explicitly, and the optional feature does not block personal daily use.
