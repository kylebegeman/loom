# L105 product

## Proposed personal browser experience

A person opens their normal trusted browser, chooses a saved login for the current site and
fills it after deliberate interaction. They can unlock from the extension/native presence
flow even when Loom and its development server are closed. The site receives the selected
credential; the surrounding development environment and agents receive neither it nor the
personal library. This claim requires a real OS/client isolation boundary.

## Entry points and complete lifecycle

Install/enable the signed extension and companion, inspect the exact browser/device pairing,
then pair through trusted local UI. Cancel a pending pairing, unpair a browser, revoke a lost
browser/device and recover/re-enroll through the reviewed owner path. Extension removal does
not delete the Vault or pretend to revoke website credentials already disclosed.

From the extension action, browser context menu or reviewed keyboard action, inspect the
current site and eligible entries, unlock if needed, choose a login and fill. Close/cancel
before disclosure and see completed/cancelled/expired requests. Lock explicitly from the
extension or trusted client; device/session lock invalidates pending requests and later fills.
A normal Loom palette entry may open setup/status but never request a personal value.

Offer save/update after a user-driven credential entry or generated-password flow, with local
review of exact site, account and target item. The page is not authority that authentication
succeeded. Cancel the prompt, keep a separate login or explicitly update an existing revision;
inspect history and restore the prior record if the update was wrong. A saved login never
silently broadens its eligible domains based on a redirect or a same-looking title.

## Matching and disclosure

Default to explicit HTTPS origins. Show the destination origin and, when different, frame
origin before approval. Similar domains, subdomain wildcards, changed ports, opaque frames,
hidden fields and navigation changes must not receive credentials under a previous match.
Cross-origin frame support is unavailable until both the top-level/frame pairing and actual
browser adapter have reviewed authorization behavior.

Autofill never submits a form automatically. After disclosure, a website's scripts can read
its form values; the UI must not promise recall. Personal filling in agent-controlled T3
preview is always unsupported, including named/saved profiles and human-looking tabs that
remain automatable. Snapshot masking cannot protect an evaluated DOM.

## State and platform coverage

States: extension missing/disabled, unsupported browser/platform, native companion absent or
incompatible, pairing pending/cancelled/revoked, isolation unproven, locked, awaiting presence,
no matches, origin/frame mismatch, document changed, save review, update conflict, disconnected
custodian and recovery required. A lost fill response is inspected and never blindly replayed.

Mac and iPhone, Safari and Chromium are Kyle's confirmed first platform targets as of
2026-10-21. Proposed acceptance covers Mac Chromium/Safari and credential-provider autofill
for supported iPhone Safari, Chrome and other branded browser apps through
[L107](../L107-personal-vault-native/). Inventory each iOS app's actual engine, extension and
credential-provider capabilities; desktop Chromium extension support is not assumed on iOS.
Exact apps/versions and extension versus provider entry remain open. iPhone support must name
its actual installed extension/provider target; the React Native app's ordinary webview is
not equivalent. Android, Windows, Linux and browser-only clients remain tracked with
clear unavailable states. Desktop app-independent means the reviewed companion/custodian can
work with Electron/server stopped, not that keys are copied into a general background daemon.

## Open priorities and review

Open choices include specific browser variants/versions, iPhone extension versus platform-provider
entry, supported frame cases, offline operation and card/identity filling. TOTP/passkey use
belongs to reviewed native/shared platform delivery, [proposed under L107](../L107-personal-vault-native/). Login prototype work
with synthetic sites can proceed now. Independent security review of custody, extension
integrity and the exact agent-isolation topology is required before critical personal use.
