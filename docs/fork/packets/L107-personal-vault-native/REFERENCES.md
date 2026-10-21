# L107 references

## Verified current source (`36de6bbd1d`)

- `apps/desktop/src/preview/Passkeys.ts:40`, `PasskeyBackend.ts:9` and `PasskeyBackendMac.ts:60`: existing browser ceremonies, abstract create/get boundary and explicit sync-claim caveat.
- `apps/desktop/src/electron/ElectronSafeStorage.ts:72`: desktop encryption wrapper; not demonstrated agent isolation.
- `apps/mobile/src/persistence/mobile-secure-storage.ts:31`: generic Expo SecureStore use, not a credential-provider extension or personal unlock gate.
- `apps/mobile/app.config.ts:216` and `:440`: current keychain entitlement/app-auth domains. Native personal provider configuration remains new work.
- `apps/server/src/mcp/toolkits/preview/handlers.ts:230`: agent evaluate access makes filling into agent-controlled pages exposure.
- [Personal Vault](../LOOM-PERSONAL-VAULT.md), [L106](../L106-personal-vault-agents/), [L108](../L108-personal-vault-sync/), [L109](../L109-personal-vault-recovery/): proposed agent exposure, offline cache and recovery boundaries. None establishes a shipped dependency/API.
- New personal-use proposal; no old Loom P/F item or reused old implementation claimed.

## Official specifications and platform guides

- [Apple ASCredentialProviderViewController](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller): credential-provider extension lifecycle and OS interactions.
- [Apple passkey credential provider extensions](https://developer.apple.com/documentation/authenticationservices/credential-provider-extensions): provider requirements; check minimum versions/entitlements during implementation.
- [Android integrate Credential Manager with a credential provider](https://developer.android.com/identity/sign-in/credential-provider): passkey/password provider service support and native flow.
- [Android optimize your app for autofill services](https://developer.android.com/identity/autofill/autofill-services): distinct password autofill integration.
- [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/): RP binding, authenticator flags, user verification and ceremonies; not an encrypted sync protocol.
- [RFC 6238 TOTP](https://www.rfc-editor.org/rfc/rfc6238.html): algorithms and test vectors.
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): OS-specific storage limitations, including Linux backend behavior.

Official links are reference targets, not fetched during design. No third-party code/assets or dependency chosen.
