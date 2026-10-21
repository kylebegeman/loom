# L110 implementation plan

## Starting point

This proposed scope is pending the owning task's priority answers. Read [Personal Vault](../LOOM-PERSONAL-VAULT.md), current health/rotation design and native custody boundaries. Use fixture credentials only; no live account change or migration is authorized here.

## Steps

1. Specify findings with concrete examples: identical password across two accounts, duplicate record, weak local estimate, unknown expiry and an actual expiring credential. Choose a reviewed offline estimator/rule budget without adding an unapproved dependency.
2. Verify independently trusted local custody and the real primitive interfaces. If not available, build pure fixture logic and disabled UI; do not decrypt via server Vault. Keep full platform/rotation ambition recorded rather than pretending the fixture is the full feature.
3. Add exact-byte reuse/duplicate logic with ephemeral keyed comparisons, rule versioning, stale-version rejection, cancellation and bounded work. Test that no secret, hash or finding inventory leaves the client, including diagnostics.
4. Add encrypted finding preferences, dismiss/restore, snooze/unsnooze and native generic reminders. Lock clears derived plaintext; wipe deletes cached findings and scheduled notifications. Device-local mode remains explicit if encrypted sync is absent.
5. Implement a fixture rotation adapter and durable two-axis journal. Prove reserve/side-effect/receipt ordering, fresh authority, manual versus provider evidence, unknown results, concurrent edit and remote-success/save-failure repair.
6. Add trusted review UI and optional metadata-only inspect/cancel services. Bind account, origin, recipient, item version and exact operation. Unsupported sites retain a reviewed manual path, with user-observed versus provider-confirmed status kept distinct.
7. Verify common provider/scheduled-agent gates and command-job rejection. Run focused tests/typechecks and authorized Mac+iPhone/Safari+Chromium fixture acceptance. Track Android/Windows/Linux/web separately and leave unproved surfaces unavailable.
8. Document user actions and limitations, record actual seams/checks and obtain independent security review before critical personal custody or real rotation adoption. Local harmless fixture work needs no additional approval gate.

## Done when

Analysis produces explainable findings offline with no leak query, lock/cancel/wipe clear transient state, reminders are reversible, and every rotation reports remote and local-save evidence separately. Unknown writes never auto-retry; changed-account/save-failed is recoverable. Real provider/platform support requires its own evidence.
