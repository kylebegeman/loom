# L108 implementation plan

Status: Designing. Proposed sequence only; no individual implementation selection or live rollout authorization. Parent: [Personal Vault](../LOOM-PERSONAL-VAULT.md).

## Before starting

Read repository guidance, packet conventions, current source and this packet. Use Kyle's daily-use, autofill and scoped-agent priorities confirmed on 2026-10-21 without dropping the complete scope; resolve detailed offline and engine policy separately. Inventory platform custody and native/browser seams before promising support. A personal extension boundary is proposed, not a usable dependency. Read [L102's maintained-engine evaluation](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys); KDBX 4 is the first candidate, not selected. Keep [L79](../L79-vault-core/), [L81](../L81-vault-grants/), [L85](../L85-vault-delivery/), [L87](../L87-vault-lifecycle/), [L88](../L88-vault-recovery/) and [L109](../L109-personal-vault-recovery/) ownership distinct.

## Steps

1. Define supported trust boundaries and offline policy with synthetic fixtures. Verify that the personal client is independently distributed and cannot be unlocked by a same-user development agent. Where unavailable, implement truthful unsupported status.
2. Evaluate whole-database/KDBX sync against a maintained client-encrypted record engine. Record exact engine/version, native key hierarchy/format, integrity, conflict/deletion handling, device revoke and recovery limits. Use engine-native primitives only; missing support stays unsupported. Independently review integration/isolation before critical personal custody; harmless local design and tests can proceed.
3. Implement/cache-test the selected engine's encrypted local saves, supported unlock/lock, storage failures, sleep/background and inspection. Verify complete database key custody and offline deadline limits. Keep raw values out of shared RPC/state persistence.
4. Use the engine's sync transport or add only a needed opaque-ciphertext relay and guarded coordination commands. Approve needed dependencies/schema scope under repo rules before applying changes. Prove transfer idempotency, conflict copies, bounded buffers and unknown-outcome inspection; receipts do not add crypto authority.
5. Test whole-database conflict-copy/engine merge or record-engine native reconciliation. Preserve both sides of conflicts and test engine tombstone/deletion behavior. A stale complete database can contain old items/permissions; block unsafe automatic republishing and expose unsupported guarantees rather than invent an anti-resurrection protocol.
6. Integrate supported engine pairing/device revoke, storage/session revocation and native re-key. Test interrupted re-key/cutover without automatic old-key fallback. Implement inspect/cancel/close/pause/resume/cache removal/recovery and explain that unlinking cannot unlearn a complete database key.
7. Integrate the Mac/iPhone/Safari/Chromium targets confirmed on 2026-10-21 behind capability checks; support still requires acceptance evidence. Inventory and track Android/Windows/Linux/web work explicitly; no generic Electron or mobile storage wrapper counts as support.
8. Test a local restore fixture independently of the relay and an L88 infrastructure restore independently of personal keys. Document recovery handoff to L109 without cross-packet internal imports or circular build dependencies.
9. After authorized implementation, run the focused checks in TESTING.md, update actual seams/results and user guidance. Real-client verification requires Kyle's browser/device authorization and is performed once by the integrating agent.

## Done when

The [repository definition](../CONVENTIONS.md#definition-of-done) and the full PRODUCT/TESTING behavior hold on each claimed surface. Unsupported surfaces stay explicitly tracked. Independent review precedes critical custody; no migration of real personal data, production deployment or new credential access follows from this document.
