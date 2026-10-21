# L107 product

## Daily-use proposal

Kyle unlocks a personal Vault from a trusted device, selects a matching login in the OS credential picker, opens quick access for an account or reads a TOTP code. These actions should work without an available Loom development server once the device has a valid encrypted local cache. Account names, usernames and TOTP seeds stay out of developer logs, shell state and Library.

## Proposed flows

- iPhone: enable Loom as an OS credential provider, unlock it when requested, choose the intended account and fill into the selected trusted app/site, including supported Safari, Chrome and other branded browser apps. Inventory actual iOS engine, credential-provider and extension capabilities per app/version; desktop Chromium extension support is not assumed on iOS. Cancel returns no credential. Inspect enabled devices, disable the provider, lock Vault and delete its local cache deliberately.
- Android: password autofill via the supported AutofillService path, and passkeys via the Android Credential Manager provider path on supported versions. These are distinct integrations and acceptance tracks, not a promise that one Expo API covers both.
- Desktop: quick access from a configured shortcut or palette action opens an independently trusted personal client. Search locally, view an account, reveal only after native authorization, close/lock and revoke cached device access. A browser cannot claim OS-wide autofill or global shortcuts.
- TOTP: validate imported parameters locally, show a code and expiry only while authorized, and stop presentation on lock/background. Copy is explicit, has a short configurable clear deadline and explains clipboard exposure; do not overwrite unrelated clipboard contents during cleanup. No seed or code enters agent tools.
- Passkeys: create and assert credentials for the validated relying party with user presence/verification. Inspect the custody type and device availability, cancel pending ceremonies, remove local records and explain separate account-side revocation. Deleting a Vault entry does not delete a site's registration.

## Custody decisions

Distinguish **OS-owned/device-bound or OS-synchronized passkeys** from any future **Loom-managed portable keys**. An OS operation succeeding does not establish that its private key is available to Loom, included in an export, or synchronized to another device. Proposed first passkey proof uses an OS-owned credential and labels portability according to actual platform evidence. A Loom-managed store is retained as a separate design option requiring reviewed key format, sync/recovery and platform-provider support; do not silently invent an export path.

A password or TOTP filled into a page can be read by that page and by an agent controlling it. Never offer personal fill into an agent-controlled preview or expose private approval UI there. A desktop process under the same OS user as an unrestricted agent is not automatically a trusted personal client. Use an independent device or demonstrate a real OS/process isolation boundary; safeStorage and browser profiles do not establish one.

## States and surfaces

Show locked, unlocking, no matching account, several matches, provider disabled, unsupported version, entitlement missing, offline cache absent, cancelled, stale device authority and remote revocation pending. Cancel and background transitions must release pending OS requests exactly once. A missing server capability must not break existing app auth or browser passkeys.

Kyle confirmed Mac+iPhone and Safari+Chromium as the first platform targets on 2026-10-21. Trusted native custody and autofill acceptance remain to be proven. Android, Windows and Linux require their own native target, credential-provider and custody tests. Standalone web can explain/setup compatible clients; any future web custody must establish independently trusted code distribution and local-key isolation from the development host. Direct/relay/tunnel connectivity transports ciphertext/status only, never turns the server into a personal key holder. Every provider and scheduled agent uses common metadata/outcome services where allowed, with no autofill, TOTP, reveal or passkey-private-key MCP tool; command jobs remain unsupported absent an explicit broker.

## Open choices

Confirm minimum iOS/Android/macOS versions, supported Safari/Chromium variants and versions, clipboard policy, recovery expectations for OS-owned passkeys, and whether Loom-managed portable passkeys are necessary for the daily-use target. Independent security review precedes critical personal custody. Synthetic native prototypes and entitlement inventory can proceed under the local implementation authorization.
