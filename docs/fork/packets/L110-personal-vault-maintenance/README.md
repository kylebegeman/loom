# L110: Private maintenance and reviewed rotation

Status: Designing. Proposed scope pending Kyle's priority answers. [L101](../L101-personal-vault-passwords/)'s first build is In progress elsewhere.

Find reused, weak and duplicate credentials locally, remind Kyle about declared expiry, and guide a reviewed account rotation with separate evidence for the remote account change and the saved Vault value. No password, hash prefix or account inventory is sent to a leak-query service.

## Scope

- In: cancellable local analysis, explainable findings, dismiss/restore/snooze, expiry reminders and rotation plans with partial-outcome recovery.
- In: provider-confirmed receipts, save-versus-account-change distinction, current-version checks and cleanup of prepared replacements.
- Out: unreviewed bulk account changes, autonomous personal credential use by agents, breach queries and claims that a heuristic proves password safety.

## Surfaces and extension boundary

Provisional first acceptance: trusted Mac+iPhone with Safari/Chromium considered independently for manual site handoff. Android/Windows/Linux/web retain explicit target/status rows and cannot perform secret analysis until trusted local custody is proven. Remote/relay/tunnel hosts see no secret-derived analysis. Existing development maintenance remains separate.

The personal authority/cache boundary is proposed in [Personal Vault](../LOOM-PERSONAL-VAULT.md), not an available common API. Missing local primitives disable analysis/rotation; do not fall back to server `VaultCore.reveal`. Existing fork settings/palette registrations can host safe setup/status. No code seams added; see [SEAMS](./SEAMS.md).

## Documents

[PRODUCT](./PRODUCT.md), [TECHNICAL](./TECHNICAL.md), [SEAMS](./SEAMS.md), [IMPLEMENTATION](./IMPLEMENTATION.md), [TESTING](./TESTING.md), [REFERENCES](./REFERENCES.md).
