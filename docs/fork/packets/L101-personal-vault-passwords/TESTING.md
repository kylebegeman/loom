# L101 testing

## Automated checks

`packages/client-runtime/src/fork/vault-password.test.ts`: policy bounds, chosen character
classes, look-alike exclusion, unbiased sampling boundaries, safe malformed/randomness failures.
`apps/mobile/src/fork/vault/password-platform.test.ts` covers secure-source failure despite an
available insecure fallback, and Android sensitive clipboard marking.
`apps/web/src/fork/utilities/tools/generate.test.ts`: existing Utilities password behavior and
other generators remain correct. Existing fork settings/palette tests cover unique registrations.

## Commands

```sh
vp test run packages/client-runtime/src/fork/vault-password.test.ts apps/web/src/fork/utilities/tools/generate.test.ts apps/web/src/fork/settings/registry.test.ts apps/web/src/fork/commandPalette/registry.test.ts apps/mobile/src/fork/vault/password-platform.test.ts apps/mobile/src/features/cloud/dpop.test.ts
vp run --filter @t3tools/client-runtime typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/mobile typecheck
vp run lint:mobile
```

Run `vp lint` only on changed source files and `vp fmt --check` on changed files. Do not run
repo-wide checks.

## Real-client acceptance

Pending explicit browser/device authorization. Verify empty open, invalid length/no classes,
all class choices, regenerate, reveal/hide, copy success and refusal, clear/close/reopen,
background clearing and keyboard/focus behavior. Test narrow layout and native keyboard.
Open with no active thread and a disconnected/upstream server; no backend call may occur.
A browser permission prompt or app switch may clear the local result; the already-requested
clipboard write has an independent lifetime. Verify actual platform behavior before calling done.

## Results and merge safety

Local automated milestone, 2026-10-21:

- 114 focused tests passed: 52 shared-generator tests, 46 existing Utilities tests, six
  settings/palette registration tests, four native adapter tests and six mobile authentication
  regressions. The latter cover a matching existing insecure RNG fallback corrected during review.
  The shared tests cover every class combination, exact entropy counts, rejection boundaries and bounded failure for malformed or unusable byte sources.
- Client-runtime, web and mobile package typechecks passed. Existing Effect suggestions are
  unrelated to the changed code and did not fail the checks.
- Targeted source lint and mobile static lint passed. Formatting, packet completeness and local Markdown link checks passed.

Real browser/device interaction remains unverified because it was not authorized. No full merge
rehearsal has run. No live credentials, services or production state were used. The mainline
integration rehearsal belongs to the normal landing workflow, not this isolated local milestone.
L101 remains In progress until its real-client acceptance and integration requirements are met.
