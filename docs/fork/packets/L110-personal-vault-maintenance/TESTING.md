# L110 testing

## Tests to add

- Proposed `packages/client-runtime/src/fork/personal-vault-maintenance.test.ts`: exact-byte reuse, Unicode/case distinctions, duplicate-account candidates versus reuse groups, no false merge, rule revisions, stale findings, dismiss/restore and snooze/unsnooze. Pure fixture tests do not prove production custody.
- Proposed trusted-client `MaintenanceWorker.test.ts` under the eventual native target: cancellation/lock mid-batch, local offline operation, bounded memory, no plaintext or digest persistence, notification payloads generic, wipe cancels reminders. Test zero network requests during analysis, including analytics and hash-prefix lookups.
- Proposed `apps/server/src/fork/personal-vault-maintenance/RotationReceipts.test.ts`: fixture remote/save axes, provider receipt versus user observation, item-version conflict, revoke before execution, concurrent cancellation, successful remote change with failed save, unknown effect and receipt-only recovery without a duplicate change. If execution stays entirely native, place this behavioral suite beside the actual native executor instead; do not create a server secret path to match a planned filename.
- Proposed `packages/client-runtime/src/fork/personal-vault-maintenance.permissions.test.ts`: destination guards, no agent scan/reveal/approve API, safe operation-level inspect/cancel, scheduled-agent parity, command-job unsupported, capability absence and reconnect invalidation.

## Focused commands after files exist, not run

```sh
vp test run packages/client-runtime/src/fork/personal-vault-maintenance.test.ts packages/client-runtime/src/fork/personal-vault-maintenance.permissions.test.ts
vp lint packages/contracts/src/fork/personal-vault-maintenance.ts packages/client-runtime/src/fork/personal-vault-maintenance.ts apps/web/src/fork/personal-vault-maintenance
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
```

If the optional server receipt dispatcher is added, run its real focused test file and `vp run --filter t3 typecheck`. Native target commands follow the actual target inventory. Mobile changes additionally run `vp run --filter @t3tools/mobile typecheck` and `vp run lint:mobile`; desktop changes run its package typecheck. Controlled clocks and effect receipts/Deferreds replace sleeps. Existing `apps/server/src/fork/vault/VaultHealth.test.ts` is a regression only if shared development-health code actually changes.

## Integrated proof, when authorized

Use a synthetic account collection on an independently trusted Mac/iPhone. Check an empty/locked inbox, reused/weak/duplicate findings, expiry around a timezone/DST boundary, stale results after editing another device, cancelled scan and generic lock-screen reminders. Inspect Safari and Chromium manual handoffs separately; no agent-controlled preview is used. A fixture provider must simulate changed-account/save-failed and unknown outcomes visibly. Test disabled notifications, offline operation, reboot, cache wipe and unsupported Android/Windows/Linux/web/older servers.

Attempt same-user host file/process/IPC access and agent evaluate; no personal analysis values, drafts or TOTP may be recovered. Inspect logs, prompt traces, shell snapshots and Library for canaries. Local/relay/tunnel status never contains secret-derived findings unless the explicitly approved recipient is the trusted client via ciphertext.

## Current evidence and merge

Packet/source checks only; no implementation, native tests, network checks, browser or live account operation run. Record the later focused check results and exact nightly merge preview after code exists. Clean-main integration rehearsal remains a later task.
