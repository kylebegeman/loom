# L111 testing

## Meaningful tests to implement

- Proposed `packages/contracts/src/fork/personal-vault-sharing.test.ts`: bounded envelope/status schemas, engine capability/protocol negotiation, opaque IDs and no plaintext/secret fields. Unknown crypto/protocol versions fail closed without breaking existing clients.
- Proposed `apps/server/src/fork/personal-vault-sharing/SharingRelay.test.ts`: recipient-scoped delivery/status, caller identity derivation, size/retention limits, idempotent acceptance, cancellation, expiry and unavailable authority. Server-admin changes cannot create an engine-authorized share or decrypt engine ciphertext.
- Proposed `packages/client-runtime/src/fork/personal-vault-sharing.permissions.test.ts`: destination guards, explicit request scope, no agent self approval/release or key verification, scheduled-agent parity, command-job rejection and capability/version absence.
- Trusted-client native tests beside the actual chosen executor: independent recipient fingerprint match; hostile directory key swap; additional-device substitution; ciphertext/metadata tampering; chosen-item/version/field binding; duplicate nonce; revoke and fresh future keys; restore with revoked recipient/device state; lost sender/recipient device. Exact target filenames/commands require platform inventory.
- Emergency tests: cancellation immediately before release, conflicting independently reviewed policy revision, clock rollback, absent authority/cancellation freshness, release followed by missing receipt, and missing owner device. A prewrapped-recipient-envelope fixture must demonstrate immediate decryption and therefore fail any enforced-wait claim. Unattended release is unavailable until a different reviewed custody implementation exists.

Run both engine alternatives: a whole-database/KDBX fixture must show item/recipient-key sharing unavailable unless a maintained integration supplies it; a record engine must prove its advertised native sharing/revoke capabilities. Use engine-native negative tests, not a mocked allow flag or a Loom-designed envelope. After revoke/expiry demonstrate a recipient can retain a previously decrypted test value, while no new envelope is delivered. Account-side rotation/session invalidation receipts are distinct from envelope deletion.

## Planned focused commands, not run

```sh
vp test run packages/contracts/src/fork/personal-vault-sharing.test.ts apps/server/src/fork/personal-vault-sharing/SharingRelay.test.ts packages/client-runtime/src/fork/personal-vault-sharing.permissions.test.ts
vp lint packages/contracts/src/fork/personal-vault-sharing.ts packages/client-runtime/src/fork/personal-vault-sharing.ts apps/server/src/fork/personal-vault-sharing apps/web/src/fork/personal-vault-sharing
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter t3 typecheck
vp run --filter @t3tools/web typecheck
```

When native targets exist, add their real crypto/lifecycle unit-test/build commands. Mobile edits additionally require `vp run --filter @t3tools/mobile typecheck` and `vp run lint:mobile`; desktop edits require its package typecheck. Use controlled clocks, receipts, worker drains or Deferreds, never sleeps or a repository-wide suite.

## Integrated acceptance, when authorized

If this optional scope is selected, use two independent synthetic personal clients on Mac+iPhone, the daily-use platforms confirmed on 2026-10-21; that confirmation does not prioritize sharing. Proposed exercise: verify keys out of band, share one version, decline another invitation, revoke future updates, change recipient key and inspect an expired share. Safari/Chromium paths are separate acceptance rows; Android/Windows/Linux/web and upstream servers stay honestly unsupported until tested. Local/direct/relay/tunnel ciphertext delivery must address the intended recipient without trusting relay identity as personal authority.

Try same-user agent file/process/IPC access, directory-key replacement, server DB rollback and prompted self approval. Inspect tool results, diagnostics, shell snapshots and Library for canaries. Emergency fixture shows visible wait/cancel/review, then release-unavailable when the trusted owner device is absent. No external message or live recipient operation is needed.

## Current evidence and merge

Only source review and packet documentation checks performed. No crypto implementation, platform feature, browser, recipient service or live sharing tested. Record actual focused results and exact nightly merge preview when implemented; clean-main rehearsal follows later landing.
