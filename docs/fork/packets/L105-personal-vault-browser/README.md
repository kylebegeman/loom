# L105: Trusted browser autofill and save

Status: **Designing**. Agent-proposed scope supporting Kyle's priorities confirmed on
2026-10-21, not an individually selected packet. Starting local personal-Vault work is authorized; the L101 first build is
**In progress** elsewhere. See [Personal Loom Vault](../LOOM-PERSONAL-VAULT.md).

Use personal logins in independently trusted Chromium/Safari clients with deliberate autofill,
save and update. Unlock must work without a running Loom development server or Electron app,
and every fill is bound to the current website, frame and document navigation.

## Scope

- In: trusted extension/native integration, explicit pairing/unpairing, app-independent unlock,
  origin/frame/navigation matching, user-initiated fill, save/update review, local operation
  inspection/cancellation, lock, revoke and recovery/re-enrollment.
- In: honest unavailable states for missing extension, native support, custody or isolation.
- Out: personal autofill in agent-controlled T3 preview, browser-debugging automation, general
  secret-return APIs, page-load automatic filling and treating a preview profile as isolation.

Login credentials are the first proposed field policy. Card/identity policies remain tracked
for later reviewed fill support. TOTP, passkeys and native OS credential-provider ceremonies are covered by
[proposed L107](../L107-personal-vault-native/), through shared adapters only when present; they are not implemented by a DOM password fill.

## Surfaces

Confirmed first platform targets (Kyle, 2026-10-21): Mac and iPhone, Safari and Chromium.
Proposed acceptance uses independent Chromium and Safari on a trusted Mac, plus supported
iPhone Safari, Chrome and other branded browser apps through reviewed credential-provider
integration in [L107](../L107-personal-vault-native/). Inventory actual iOS engine/extension
capabilities and installed targets; desktop Chromium extension support is not assumed on iOS. A shared-principal
agent host is not automatically trusted. Android browser/platform delivery, Windows/Linux native
companions and other browser-only combinations remain explicit targets and unavailable until
implemented. Generic Loom web/desktop/mobile UI shows safe status/launch guidance only.
Local, remote, tailnet, relay and tunnel environments never gain personal custody.

## Extension points and seams

`ext-personal-vault` is proposed, not implemented. Use shared custody, typed lookup and
purpose-bound local delivery primitives if available; otherwise disable personal autofill.
No numbered packet's private internals are a dependency. Browser packaging/native messaging
has no current personal extension point or registered host. [SEAMS.md](./SEAMS.md) identifies
candidate new target boundaries, not already added code.

## Documents

- [PRODUCT.md](./PRODUCT.md): trusted-browser flows and states.
- [TECHNICAL.md](./TECHNICAL.md): matching, local delivery and trust model.
- [SEAMS.md](./SEAMS.md): packaging and existing-preview boundary.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): sequence for Chromium/Safari.
- [TESTING.md](./TESTING.md): adversarial matching and lifecycle evidence.
- [REFERENCES.md](./REFERENCES.md): verified source and official APIs.
