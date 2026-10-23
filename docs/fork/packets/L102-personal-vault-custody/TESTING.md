# L102 testing

## Current verification

Design/source review only. The paths in REFERENCES were checked in the current checkout.
No custody implementation, crypto package, browser, dev server, native build or real credential
has been exercised. L101's separate local first build is not evidence for this trust boundary.

## Proposed focused suites

- `packages/contracts/src/fork/personal-vault-custody.test.ts`: versioned safe-status shapes,
  rejection of secret-bearing wire input and unavailable-capability behavior.
- `packages/client-runtime/src/fork/personal-vault-custody.test.ts`: late unlock/presence
  callbacks lose to lock/revoke, stale trust stays visible and errors contain no private data.
- A selected engine/native target suite: known-answer and independent format-open fixtures,
  malformed/tampered/unknown-version files, wrong factors, crash-safe write, metadata opacity,
  and exact recovery interoperability. Choose its file names and command from the real target.

After those TS tests exist, run only:

```sh
vp test run packages/contracts/src/fork/personal-vault-custody.test.ts packages/client-runtime/src/fork/personal-vault-custody.test.ts
vp lint packages/contracts/src/fork/personal-vault-custody.ts packages/client-runtime/src/fork/personal-vault-custody.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
```

Typecheck actual consumers changed, and add desktop/mobile checks only when their code changes.
No native custody build command exists yet; do not claim `vp` proves a hypothetical helper.

## Isolation and recovery evidence

Use synthetic secrets and an adversarial process with the same privileges as an ordinary
full-access agent. Attempt storage/keychain read, IPC impersonation/replay, binary replacement,
process inspection, browser debugging and UI automation. Capture only canary pass/fail
results, not memory dumps containing real data. A process split, safeStorage availability or
biometric prompt alone cannot make this test pass.

Exercise create/cancel setup, presence deny/cancel, manual lock, idle/session lock, sleep,
backgrounding, crash/restart, two-device enrollment/cancel/expiry, loss/revocation, offline stale
trust, restore and re-key interruption. Verify encrypted labels/domains/history at rest and
absence from server traces, RPC/MCP data, prompts and logs. Recover onto a clean trusted client,
then prove old admission/revocation state cannot regain write authority.

## Acceptance surfaces and merge safety

With explicit authorization, a primary agent/Kyle verifies independently trusted Mac and iPhone
flows once integrated; Safari/Chromium clients are included only when their actual trusted
adapter exists. Check Android/Windows/Linux/general web unsupported states and old/upstream
servers without the feature. Do not use confidential data or agent-controlled T3 preview.
No manual run or merge rehearsal is claimed here. Code implementation later records focused
results and required seam/merge checks; no repo-wide suite for this documentation.
