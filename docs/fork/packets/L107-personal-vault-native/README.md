# L107: Personal credentials in native daily use

Status: Designing. Proposed scope pending Kyle's priority answers. [L101](../L101-personal-vault-passwords/)'s first build is In progress elsewhere.

Make personal credentials available through the OS credential picker, a trusted desktop quick-access window and local TOTP presentation. Include passkey creation/assertion with explicit custody, synchronization and export decisions rather than treating existing browser WebAuthn support as a Vault passkey store.

## Scope

- In: iOS credential-provider extension, Android password autofill and credential-provider support, desktop quick access, TOTP, native unlock/lock/revoke and cancelled-ceremony cleanup.
- In: passkey RP/origin validation, user verification, key lifecycle and truthful device-bound versus portable status.
- Out of the initial fixture milestone: claiming all OS versions/browsers supported or exporting a nonexportable platform private key. Full platform ambition remains tracked.

## Surfaces

Provisional first acceptance is a trusted Mac and iPhone with Safari and Chromium tested separately. Android, Windows, Linux and ordinary web remain explicit target tracks, not inferred support. Each unavailable OS provider/entitlement shows setup required or unsupported; the server's development Vault remains usable separately.

## Extension points and seams

Existing settings/palette registrations can advertise safe setup/status. `ext-desktop` and the personal native-custody boundary are proposals to verify, not implemented APIs in the inspected tree. Native targets and build/config touches require the inventory in [SEAMS](./SEAMS.md).

## Documents

[PRODUCT](./PRODUCT.md), [TECHNICAL](./TECHNICAL.md), [SEAMS](./SEAMS.md), [IMPLEMENTATION](./IMPLEMENTATION.md), [TESTING](./TESTING.md), [REFERENCES](./REFERENCES.md). Shared decisions live in [Personal Vault](../LOOM-PERSONAL-VAULT.md).
