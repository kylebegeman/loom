# L107 technical design

Proposed native work against source baseline `36de6bbd1d`. Paths introduced below do not yet exist.

## Current source and limits

`apps/desktop/src/preview/Passkeys.ts:40` owns an existing browser ceremony service. `PasskeyBackend.ts:9` defines create/get; `PasskeyBackendMac.ts:60` warns that native synchronized-passkey claims are unreliable. This is neither a Loom-owned credential database nor evidence of portable/synced Vault private keys. Preserve existing browser/app authentication.

`apps/desktop/src/electron/ElectronSafeStorage.ts:72` wraps encrypt/decrypt in the desktop process. `apps/mobile/src/persistence/mobile-secure-storage.ts:31` wraps Expo SecureStore without per-operation personal authorization in that service. Neither is sufficient evidence of protection against a full-access same-user agent. `apps/mobile/app.config.ts:216` has keychain entitlements and `:440` describes native app-auth domains; neither declares an existing personal credential-provider extension.

## Proposed native architecture

Put personal credential presentation and key operations in a separately trusted native component. React/client-runtime receives opaque selection/ceremony IDs and nonsecret state only. The OS credential-provider extension may supply a selected password directly to the OS requesting context after origin/app validation and unlock; it must not route it through environment RPC, MCP, Electron renderer state or the React Native JS bridge.

iOS needs an AuthenticationServices credential-provider extension, explicit extension entitlement and narrowly scoped app/keychain sharing between the personal app and provider. Android needs separately registered AutofillService and, on supported versions, CredentialProviderService with package/signing-certificate and requesting-origin verification. Background lock, OS cancellation, biometric enrollment changes, device-lock policy and cache-wipe behavior are native responsibilities. Do not reuse widget/shared-agent app groups for personal keys. An Expo config plugin can generate native declarations, but actual native targets and entitlements must first be inventoried; do not hand-edit generated outputs as the source of truth.

For Mac quick access, proposed `apps/desktop/src/fork/personal-vault-native/` can expose setup/status and launch a trusted companion. It must not hold personal keys within an unrestricted agent's trust domain. A distinct signed client, independent user/device authority and tested IPC/code integrity are requirements, not proof supplied by a separate window. Keep reveal/fill disabled on an unproven same-user host; phone custody remains a usable alternative.

## Local contracts and passkey decisions

Proposed `packages/contracts/src/fork/personal-vault-native.ts` defines metadata state: platform/OS capability, provider registration, custody kind, ceremony id, RP id, credential public id, user-verification requirement, expiry and typed cancellation/failure. No private key, password, TOTP seed/code or unrestricted native payload is serializable on environment RPC. Optional `loom.personal-vault-native.status`/`.cancel` methods return metadata and include `EnvironmentAuthorizationError`; destination cancellation uses the fork permission map and `createEnvironmentRpcCommand`. Personal authority remains an additional independent gate.

Creation/assertion must bind to OS-verified app identity, committed origin and RP ID, validate challenge/algorithm/allowCredentials, enforce actual user verification, and return WebAuthn responses only to the authorized relying-party ceremony. Never grant an arbitrary challenge signing oracle to MCP. OS-owned credentials remain in the OS store; Loom records capability/credential references but cannot promise key export, recovery or Loom sync. A future Loom-managed mode must use the selected maintained engine's actual passkey storage/export/recovery primitives and a compatible native provider. L102 evaluates KDBX 4 first; neither KDBX compatibility nor a password record implies passkey capability. Missing engine support stays unavailable; do not introduce a custom key format to fill the gap. Passkey backup eligibility/state flags are evidence about that authenticator, not a universal sync guarantee.

TOTP runs inside the native unlocked boundary, with explicit algorithm/digits/period validation and RFC test vectors. A code is derived on demand, invalidated on lock and never included in shared atom snapshots. System time affects codes; show drift guidance without automatically contacting accounts. A textual expiry with boundary updates suffices; no continuously repainting ring.

## Storage, lifecycle and integration

Native storage contains only encrypted cached records and separately protected local key material. Search indexes are local, encrypted at rest and unavailable while locked. Distinguish cache removal, device unlink, Vault-item deletion and provider-site credential removal. Define bounded active-ceremony retention, cancel and exactly-once settlement. Revoke new uses when current authority is known; remote offline-device revocation cannot erase already decrypted material.

The proposed personal cache/custody primitive must be verified at implementation time. Consume a versioned interface only when it exists; otherwise mark offline/credential presentation unsupported. Do not depend on another packet's UI or assume [L108](../L108-personal-vault-sync/) is implemented. [L109](../L109-personal-vault-recovery/) records the recovery implications, not a prerequisite that can magically export OS keys.

Proposed UI paths are `apps/mobile/src/fork/personal-vault-native/` and `apps/web/src/fork/personal-vault-native/` for setup/status, with atoms in `packages/client-runtime/src/fork/personal-vault-native.ts`. Gate client feature, OS provider and trusted-custody readiness separately. No secret delivery tools are added. Inspect/cancel status, if agent-visible, uses the common service for all providers and scheduled agents; command jobs have no broker.

## Alternatives

Reject server-held master keys, shared JS state for TOTP/secrets, and treating existing authentication ceremonies as a synchronized personal passkey store. Prefer native OS context verification over DOM heuristics. Keep desktop shortcut support separate from the independent custody proof and from the decision to support any particular platform.
