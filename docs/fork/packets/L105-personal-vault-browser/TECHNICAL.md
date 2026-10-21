# L105 technical design

## Existing browser authority is unsuitable

`apps/server/src/preview/ServerBrowser.ts:770` creates isolated preview contexts when no profile
is supplied, while `:786` selects named profiles/desktop pages. Neither is personal custody.
`apps/server/src/preview/ServerBrowserPage.ts:851` evaluates caller JavaScript; `:673` fills
fields. Snapshot masking at `:584` does not prevent DOM-value reads through evaluation.

`apps/desktop/src/preview/Passkeys.ts:140` configures preview WebAuthn handling; it is not a
personal passkey manager or an autofill isolation proof. Current application registrations
contain no personal Chromium native-messaging host, Safari web extension or mobile credential
provider. The proposed personal API and packaging do not exist.

## Proposed trusted-client integration

Place schemas/pure matching in fork-owned `personal-vault-browser` modules; browser extension,
native companion and Apple targets need explicit new build/packaging choices. Do not invent
an existing package or registration helper. Consume proposed `ext-personal-vault` custody,
typed lookup, local receipts and purpose-bound delivery primitives only when implemented;
absence yields unsupported, never a fallback to environment reveal.

Chromium uses a reviewed extension action/background/content-script split with a local native
messaging host or equivalent reviewed custodian link. Safari uses its reviewed web extension/
containing-app communication or Apple credential-provider adapter as appropriate. [L107](../L107-personal-vault-native/) covers native OS provider ceremonies; this packet
owns browser matching, extension interaction and save/update policy. iPhone must
have an actual signed installed target and supported entitlement; sharing/widget/keychain
configuration alone does not supply it. No production dependency or entitlement is selected
by these documents.

The companion works independently of Electron/T3 server lifetime. It authenticates browser
extension identity, local device pairing, owner custody state and current purpose. Extension
ids, allowlists, a localhost port or a process name alone are insufficient caller proof against
same-user agents. Use the reviewed OS boundary; if arbitrary agent code can imitate the caller,
read browser state, debug the profile or drive approving UI, mark the topology unsupported.
Personal browser sessions and custodian should reside outside the agent OS principal/device
unless the alternative topology has positive isolation evidence.

## Matching and final-use checks

1. Treat page content as untrusted. Obtain tab/frame/document identity and URLs from browser
   APIs/sender context, not solely a content-script message payload or DOM-provided hostname.
2. Parse with a standards-conforming URL implementation. Default matching is exact HTTPS
   scheme/host/effective port against stored explicit origins; normalize host case and default
   ports, not domain ownership. No suffix/substring matching, URL credentials or implicit
   `www`/subdomain expansion. Show Unicode and encoded host clearly when ambiguity matters.
3. Bind a short-lived local request to browser instance, tab, top-level origin, target frame,
   frame origin, document/navigation identity, selected item revision, field purpose and
   current unlock epoch. Deny opaque/unverifiable origins and unsupported frame contexts.
4. Require an explicit trusted action. A frame differs from its top-level origin only under
   a reviewed explicit top/frame policy; absent that policy, report unsupported. Do not
   expose the entire item library to content scripts for filtering.
5. Immediately before delivery, recheck custody/revocation, tab/frame/document identity,
   origins, item revision and visible/editable field purpose. Navigation, frame replacement,
   expiry, lock and permission change invalidate the request. A late reply cannot fill a
   replacement document. Define a one-shot final insert that checks its document binding
   within the target context; fail closed if the adapter cannot close the navigation race.
6. Deliver only the selected fields through the reviewed trusted-browser path. No clipboard
   relay, server reveal, generic get-secret endpoint, automatic form submission or replay of
   a request with an unknown disclosure outcome. Record non-secret local delivery status.

After fill, scripts in that origin may read the value; that deliberate disclosure cannot be
undone. This is why an agent-readable profile or T3 preview is excluded even if a snapshot
redacts passwords. Denying a managed-preview caller alone does not prove a separate external
browser is safe from a same-user full-access agent.

## Save/update and reverse states

Capture proposed fields only after a relevant user interaction in the trusted browser; no
broad keystroke collection, page-wide library scanning or server telemetry. A save request
binds observed origin/frame/document, local field semantics and a reviewed destination.
Treat submission/success heuristics as suggestions, never proof of login success.

Present a trusted local review with keep-separate/update/cancel. Updating requires the current
expected revision and cannot append an unreviewed origin. Use encrypted shared item history
and receipts if available; missing storage means save is unavailable. Cancel before commit;
after commit inspect the result and offer a new history-restore operation. Crash/restart and
lost results do not create duplicate saves.

Pairing and unlock requests have inspect/cancel/expire states. Unpair/revoke invalidates local
sessions and pending delivery; browser suspension/extension worker restart cannot resurrect
a stale unlock. Recovery establishes a newly verified pairing rather than replaying old
browser tokens. Extension updates require versioned protocol negotiation and signed identity
continuity; mismatches disable delivery.

## Data, capabilities and agents

Keep matching metadata, suggestions and receipts inside trusted clients; encrypt persisted
origins, item names, save history and pairing details. No all-site decrypted cache or persisted
plaintext content-script storage. Content scripts receive only final selected fields for an
authorized document and discard transient buffers on completion/lock where feasible.

No personal autofill/search/save-value MCP or environment RPC. Proposed
`loom.personal-vault-browser.*` safe status RPC, if needed, uses guarded scopes and
`EnvironmentAuthorizationError`; it carries no personal URL/query/value. Common service/MCP
capabilities apply equally to all providers and scheduled agents. Command-only jobs remain
unsupported without an explicit broker, and no provider permission mode bypasses user presence.

[L84](../L84-vault-test-accounts/) development preview accounts remain separate from personal
autofill. [L85](../L85-vault-delivery/) workload delivery and
[L86](../L86-vault-approvals/) remote agent approvals cannot substitute for local personal
presence. Shared personal primitives, when available, are consumed without numbered-packet
internal dependencies.

## Performance and alternatives

Use on-demand matching for the active document with bounded local suggestions. No continuous
full-page scanning, per-keystroke host calls or repainting timer. Request only needed host
permissions with explicit setup/disable controls. Server-side autofill and extending preview
profiles were rejected because they put personal values under agent/server browser authority.
