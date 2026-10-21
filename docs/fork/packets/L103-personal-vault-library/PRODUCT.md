# L103 product

## Personal library tasks

A person can find and use a credential without exposing the rest of their library to the
development environment. Sensitive item names and browsing history deserve the same custody
as password fields. The proposed library offers:

| Item              | Useful fields and actions                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Login             | Multiple website origins, username, password, custom fields, notes and related items.          |
| Secure note       | Plain text note plus protected custom fields; no executable embedded HTML.                     |
| Recovery material | Recovery codes/keys, service/account context and explicit used-code marking with correction.   |
| Payment card      | Cardholder, number, expiry, verification code and billing reference, individually revealable.  |
| Identity          | Names, contact/address fields, documents and explicitly sensitive custom fields.               |
| File              | Encrypted bytes, original name/type, size and integrity information; explicit open/save/share. |

TOTP seed, issuer and account are sensitive fields on relevant records. This packet preserves
and edits them; it does not promise code generation/use until a reviewed adapter exists.
Passkey private material is never represented as an editable login password field.

## Find, edit and undo

Search locally while unlocked; filter by type, favorites and archive. Open a record, reveal
one protected field, hide it, copy deliberately and clear an owned clipboard value when the
local platform permits. An expiry is disclosed without promising control over clipboard
history or other applications. Favorite/unfavorite and clear search without server requests.

Create/edit with cancel; preserve edits locally only under the approved encrypted storage
policy. Inspect history, compare within trusted UI and restore an old version as a new
version. Archive hides a record from normal search and autofill; restore makes it eligible
again. Delete shows recoverable-retention versus permanent-purge semantics. Recovery or
history restoration does not rotate credentials already used at a website.

Export chosen records as an encrypted portable file through a trusted local picker. Inspect
selection, cancel before commit and verify the result. Raw personal values, exports and
metadata are never attached to a thread, routed through MCP/RPC or shown in server logs.

## Entry points and states

A trusted-client Vault home opens search, detail, favorites, history and archive. Context
menus and shortcuts call the same local operations; close/back cancels transient reveal and
restores focus. Ordinary Loom settings/palette can open that client with opaque context,
without personal item titles or search queries. Inspect current local writes/exports and
resolve interrupted outcomes rather than repeating blindly.

States include first-run empty, locked, unsupported client, loading local data, no matches,
archived, field hidden/revealed, unsaved edit, version conflict, damaged attachment, write
failure, export pending/cancelled/interrupted, revoked device and recovery required. Lock or
revocation removes detail/search plaintext and cancels outstanding reads; reopening requires
current custody authority. No default search index persists in plaintext.

## Surface policy and open priorities

Trusted Mac plus iPhone is the provisional first acceptance. Independently trusted browser
extensions may follow; agent-controlled T3 preview never hosts the library. Android,
Windows/Linux and general web remain explicitly tracked and unavailable for private data
until their trusted storage/custody integration exists. Remote/tunnel use may carry opaque
ciphertext under a future shared primitive; the development host never resolves a title.
Older/upstream servers continue their ordinary experience without a fabricated Vault feature.

Kyle still needs to prioritize the initial item types, file-size expectations, retention and
history limits, offline editing and clipboard behavior. The complete typed-library ambition
remains in scope. A local fixture UI can be built now; critical personal data needs proven
custody and independent security review before use.
