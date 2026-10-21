# L105 references

## Checked current source

- `apps/server/src/preview/ServerBrowser.ts:770` and `:786`: agent contexts, named profiles and desktop-page selection.
- `apps/server/src/preview/ServerBrowserPage.ts:584`, `:673` and `:851`: masking, field fill and arbitrary JavaScript evaluation.
- `apps/desktop/src/preview/Passkeys.ts:140`: current preview WebAuthn configuration, not personal credential custody.
- `apps/desktop/src/preload.ts:77`: ordinary desktop bridge; the optional fork IPC extension is absent.
- `apps/mobile/app.config.ts:157` and `:216`: sharing/keychain declarations, not credential-provider support.
- `apps/web/src/fork/settings/registry.ts:26`: existing fork settings registration.

Scoped app registration/packaging searches found no personal Chromium native-messaging host,
Safari web extension, Apple credential provider or Android autofill service. Generated/vendored
output was not used to claim an application feature.

## Loom scope and overlap

[Personal umbrella](../LOOM-PERSONAL-VAULT.md), [L84 test accounts](../L84-vault-test-accounts/),
[L85 development delivery](../L85-vault-delivery/) and [L86 approvals](../L86-vault-approvals/).
Their service/grant/approval paths do not authorize personal browser disclosure. The
[old V selections](../../selections.md#loom-vault) do not select this new packet, and no old
Loom personal extension implementation is asserted. [Proposed L107 platform/passkey/TOTP
scope](../L107-personal-vault-native/) is tracked in the umbrella; consume actual shared adapters when present.

## Official external references

- [Chromium native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): host registration, extension allowlists and local message boundary.
- [Chromium content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): execution worlds/frame injection, not OS isolation.
- [Chromium messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging): sender handling and untrusted content-script data.
- [Safari web extensions](https://developer.apple.com/documentation/safariservices/safari_web_extensions): actual Apple packaging and platform requirements.
- [Safari app communication](https://developer.apple.com/documentation/safariservices/communicating-between-the-app-and-your-safari-web-extension): native containing-app boundary.
- [Apple credential provider](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderviewcontroller): platform credential presentation alternative.
- [Android autofill services](https://developer.android.com/identity/autofill/autofill-services): tracked Android native delivery surface.
- [WHATWG URL](https://url.spec.whatwg.org/) and [HTML origins](https://html.spec.whatwg.org/multipage/browsers.html#concept-origin): exact URL/origin semantics.

Official links are provided without network fetching or validation claims. No third-party
extension code/assets or dependency was introduced; actual bindings need license review.
