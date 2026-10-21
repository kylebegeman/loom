# L103 implementation packet

## Local work before private data

Read the [umbrella](../LOOM-PERSONAL-VAULT.md), conventions and existing development reference
and core services. Inspect actual shared personal primitives. An absent primitive is a clear
unsupported state, not a reason to invent a server reveal path. Synthetic library fixtures
allow harmless local work while custody and priorities are settled.

## Build sequence

1. Define versioned local item/field schemas for all six item families, including unknown
   field preservation, typed TOTP storage and protected metadata. Specify bounded field,
   attachment and history policies using Kyle's prioritized size/retention requirements.
2. Add pure library behavior against an encrypted-repository test double: revision checking,
   lifecycle transitions, history restore-as-new, stable receipts and cancellation outcomes.
   Test a real version-conflict failure before wiring presentation.
3. Bind to reviewed shared encrypted storage/custody primitives only when implemented. Keep
   keys and decrypted indexes outside server state and ordinary environment query caches.
   Prove lock/revoke invalidates pending local reads and delayed render results.
4. Build trusted-client list/search, favorites, detail/edit, archive and history. Handle
   no matches, empty/locked/unsupported states and revision conflicts. Expose close/cancel,
   unpin and restore through the same operations used by menu/shortcut entry points.
5. Add per-field reveal/hide and explicit copy with owned-clipboard cleanup where supported.
   Test card/identity/recovery data without logging fixture values. TOTP display remains
   unavailable until a reviewed native/shared crypto adapter supports its exact parameters.
6. Add encrypted attachment open/save/share with local bounds, integrity checks, safe names
   and cleanup on cancel/lock/error. Avoid active previews and remote metadata requests.
7. Add encrypted portable export through the shared reviewed export primitive. If absent,
   disable it with the reason. Inspect selection and output status, cancel before commit,
   verify by reopening an encrypted fixture and reconcile unknown outcomes.
8. Wire non-secret trusted-client launch/status into Loom entry points. Track Mac/iPhone
   acceptance separately from Android/Windows/Linux/general web unsupported coverage. No
   provider adapter or agent gets a private search/list bypass.
9. Run the focused tests and changed-package checks. Verify actual trusted-client behavior
   with authorization and record independent security-review requirements before critical
   personal data use. Update product help with lock, retention and export limits.

## Completion evidence

All typed data round-trips without silent drops; search stays local; every mutation has an
inspectable result and reversal where meaningful; lock/revoke wins pending reads. An encrypted
export opens in a clean trusted client and private metadata never appears in Loom server,
RPC/MCP/prompt/log state. No completed library or selected API is asserted by this packet.
