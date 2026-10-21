# L111 product

## Optional proposal

After personal daily use works, Kyle may want to give a specific person one selected credential or emergency access to a small collection. This is optional scope, not a requirement for adopting Personal Vault. Avoid converting personal storage into team administration by default.

## Ordinary sharing

These requirements are conditional on the maintained engine selected through [L102](../L102-personal-vault-custody/) actually supporting per-item recipient-key sharing. KDBX-compatible whole-database storage does not imply this capability. Missing support means unavailable, not a new Loom crypto format.

From an item detail, choose exactly which fields and item version to share, select a recipient and verify their public-key fingerprint through an independent channel or an in-person QR exchange. Show who can decrypt, whether updates are included, expiry and the effective revoke limits before sending. Default proposal: one version, one recipient, no automatic future updates and no full-vault key.

The recipient can accept/decline, inspect provenance/version/expiry, remove the local copy and report a lost device. The sender can cancel a draft/invitation, inspect pending/accepted status, change future-update policy, expire/revoke future delivery and rotate the underlying account where appropriate. A new recipient key requires fresh verification; a matching name or server directory record is insufficient.

A recipient who decrypted or copied a password may retain it after revoke or expiry. Removing an envelope or rotating the Vault key cannot make that copy disappear. Account-side password/token changes may stop future use; already authenticated sessions and downloaded data can remain. Show whether upstream revocation was actually confirmed. Nonexportable passkey private keys cannot be shared by exporting a Vault record; any future delegated-use option must use a separate proven operation capability.

## Emergency waiting and review

An emergency contact requests access to a preselected scope. Kyle sees requested items, recipient key, wait duration, release model and deadline; can deny/cancel/revoke or shorten/extend only through a new independent policy review. The contact can inspect/cancel their request. Notifications are hints; the current approved policy and trusted release state are authoritative. Display pending, waiting, ready-for-review, released, denied, cancelled, expired, release-unavailable and unknown-outcome states.

A ciphertext already wrapped directly to the recipient can be decrypted immediately, regardless of a server's countdown. Proposed safe initial emergency mode therefore requires an independently trusted owner device to release at/after the wait, with current policy and cancellation checks. If no trusted release device is available, **release unavailable** is the honest result. Unattended release after the owner/device is lost remains an unresolved optional design requiring independently trusted custody/quorum and recoverable cancellation; an ordinary development server cannot enforce it while holding the unlock material.

## Surfaces and authority

Mac+iPhone are provisional acceptance candidates, with Safari/Chromium tested independently only where a trusted web/companion flow exists. Android/Windows/Linux/web remain explicit unsupported recipient/custody tracks. Do not unlock in code served by the development host merely because its TLS/login works. Full-access same-user agents require an actual independent device or proven OS/process boundary; profiles, UI permissions and safeStorage are not sufficient.

Agents for every provider and scheduled agent run may use the same explicitly granted request-status/cancel service, never select recipients, verify keys, approve/release shares or retrieve raw values. No personal material enters RPC/MCP/prompt, shell snapshots or Library. Command jobs remain unsupported until an explicit broker. Local/direct/relay/tunnel transport cannot mint recipient or release authority; older/upstream servers show unavailable.

## Decisions still open

Decide whether sharing is wanted, initial recipient enrollment/verification, one-version versus future-update policy, expiry defaults and emergency threat/availability goals. Independent security review precedes critical personal custody and emergency adoption. Synthetic local designs/tests remain authorized without a new approval gate.
