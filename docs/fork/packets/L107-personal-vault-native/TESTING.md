# L107 testing

## Automated and native proofs to add

- Proposed `packages/contracts/src/fork/personal-vault-native.test.ts`: capability/status schemas contain no credential payload; distinguish password autofill, passkey provider and browser-auth support; unsupported/locked/cancelled outcomes.
- Proposed `packages/client-runtime/src/fork/personal-vault-native.test.ts`: OS/version and custody readiness, no plaintext state retention, stale-device state on reconnect and destination-bound cancellation permissions.
- Proposed `apps/desktop/src/fork/personal-vault-native/QuickAccess.test.ts`: duplicate shortcut registration, unavailable trusted companion, untrusted IPC sender, close/lock/revoke and clipboard clear only when still owned. This is not the native custody proof.
- Proposed `apps/mobile/src/fork/personal-vault-native/totp.test.ts`: RFC 6238 SHA-1/SHA-256/SHA-512 vectors and boundary seconds; invalid digits/period/seed rejected; lock/background discards presentation. Native generation must be exercised too; a JS fixture implementation does not prove where production secrets live.
- Actual native targets need tests for OS-verified requesting app/site, phishing origin and cross-frame mismatches, two matching accounts, biometric cancel/enrollment changes, device lock/reboot, extension memory limits, exactly-once cancelled response, provider disable and offline cache deletion. Name their real files/commands after native target inventory; none exists yet.

Passkeys: fixture RP tests create/get, malformed challenges, unsupported algorithms, user verification required, allowCredentials mismatch, abort/background/timeout and replay. Verify credential discovery after a second-device enrollment and clean-device recovery separately; record **unavailable** for nonexportable keys rather than claiming portable backup. Existing `apps/desktop/src/preview/Passkeys.test.ts` and `PasskeyBridge.test.ts` are regression targets only if those existing paths change.

## Planned focused commands, not run

```sh
vp test run packages/contracts/src/fork/personal-vault-native.test.ts packages/client-runtime/src/fork/personal-vault-native.test.ts apps/desktop/src/fork/personal-vault-native/QuickAccess.test.ts apps/mobile/src/fork/personal-vault-native/totp.test.ts
vp lint packages/contracts/src/fork/personal-vault-native.ts packages/client-runtime/src/fork/personal-vault-native.ts apps/desktop/src/fork/personal-vault-native apps/mobile/src/fork/personal-vault-native apps/web/src/fork/personal-vault-native
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/desktop typecheck
vp run --filter @t3tools/mobile typecheck
vp run --filter @t3tools/web typecheck
vp run lint:mobile
```

Add server typecheck only if a server metadata method is implemented. Native build/unit-test commands must be recorded from the actual new targets, not guessed. No repo-wide suite is needed for packet documents.

## Integrated matrix, when authorized

Trusted Mac+iPhone, Safari and Chromium each: enable provider, unlock, select correct fixture account, cancel a second request, lock mid-request, read a TOTP near rollover and create/assert a fixture passkey. Test iPhone offline/reboot and app-switcher privacy. Test Android AutofillService and Credential Manager on supported versions as separate rows. Windows/Linux/web must show truthful unsupported states until their providers and custody are tested.

Use a same-user full-access attacker fixture to inspect host files/processes, automation/IPC and agent preview evaluate; no private credential/UI may become available there. Check diagnostics, screenshot history, clipboard, shell snapshots and Library for fixture canaries. Test remote/relay/tunnel status without moving native secrets to the environment. Older/upstream server behavior remains intact. Providers/scheduled agents cannot request TOTP/reveal/signing through hidden endpoints; command jobs stay unsupported.

## Current evidence

Source/packet checks only. No devices, browsers, servers, native builds or feature tests run. Verify exact merge seams/nightly preview after implementation; main integration rehearsal is a later clean-main task.
