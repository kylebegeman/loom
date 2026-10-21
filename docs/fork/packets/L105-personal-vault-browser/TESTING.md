# L105 testing

## Current status

Source/packet review only. No browser, extension, native host, service, credential, automated
fill or platform build was launched. The personal extension API and packaging do not exist.

## Proposed automated proof

- `packages/contracts/src/fork/personal-vault-browser.test.ts`: versioned safe protocol,
  operation receipts, unsupported/skew states and secret-free environment status shapes.
- `packages/client-runtime/src/fork/personal-vault-browser.test.ts`: exact origin/port matching,
  punycode/lookalike hosts, frame/document binding, stale revision, expiry, cancel/lock/revoke,
  update conflicts, idempotent save and unknown-disclosure outcomes.
- Actual extension/native suites: authoritative sender validation, malicious content-script
  messages, unauthorized host/extension identities, browser suspension/worker restart and
  document-bound final insertion. Use actual target-manifest commands after packaging exists.

TS commands after the proposed files exist:

```sh
vp test run packages/contracts/src/fork/personal-vault-browser.test.ts packages/client-runtime/src/fork/personal-vault-browser.test.ts
vp lint packages/contracts/src/fork/personal-vault-browser.ts packages/client-runtime/src/fork/personal-vault-browser.ts
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/client-runtime typecheck
```

Pure matcher tests do not prove the browser adapter's final-use race handling or OS isolation.
Build/typecheck changed browser/native consumers from their actual manifests; no imaginary
extension build command or repo-wide verification is claimed.

## Authorized integrated scenarios

On independently trusted Mac Chromium/Safari and iPhone Safari, use synthetic HTTPS sites.
Test explicit fill/save/update, cancelled presence, no matches, archive exclusion, exact
origin/port, unrelated subdomain, deceptive suffix, IDN, redirect after approval, frame swap,
cross-origin/opaque/sandboxed frames, hidden decoys, detached inputs and navigation while the
native reply is delayed. Final insertion must target the approved live document or not occur.
No automatic submit. Approved website scripts can observe delivered data, as disclosed.

Close Electron and stop only the test server process the primary agent started; independently
unlock/fill still works through the actual trusted component. Test companion absent, protocol
skew, extension disabled/removed, revoked pairing, browser restart, device loss, recovery and
re-enrollment. Lock/cancel/revoke during pending selection/presence/delivery/save; inspect lost
responses and prove they never blindly re-fill or duplicate a saved record.

Attempt same-principal local messaging impersonation, browser debugging and approval UI
automation with synthetic canaries. If available agent privileges can obtain values, the
claimed topology fails regardless of profile names, biometric labels or snapshot redaction.
Explicitly prove T3 preview, including saved profiles, cannot receive personal fill. Inspect
synthetic transport/log traces for titles, site URLs, usernames, values and seeds; none may
reach Loom RPC/MCP/prompt/server state.

Check Android, Windows, Linux and general web unsupported states plus older/upstream-server
compatibility. No confidential personal autofill in T3 preview during any verification.
Independent review must cover the actual signed extension/custodian before critical use.

## Merge safety

No code seams or merge preview/rehearsal yet. Implementation later records exact build/target,
focused checks and applicable seam/merge outcomes. Browser/device use requires authorization
and primary-agent integration; design subagents do not launch it.
