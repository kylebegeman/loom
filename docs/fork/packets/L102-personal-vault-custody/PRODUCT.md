# L102 product

## Problem and proposed outcome

A personal password manager must stay private while Loom agents work unattended. Today's
server Vault can read its records and explicitly reveal values. Moving personal records into
that service would give the development host custody, even if the settings UI calls them
personal. This packet proposes a separate owner-controlled trust boundary.

## Owner journey

1. On a trusted client, create an owner identity and Vault. Explain which devices and OS
   principals can unlock it. Loom account sign-in and environment administration grant no
   decryption rights by themselves.
2. Establish an unlock factor and a separate recovery method. Verify the recovery method
   before treating setup as recoverable; allow abandoning an incomplete setup.
3. Unlock in independently authenticated native UI, see the current device and lock policy,
   then lock explicitly. Denied/cancelled presence leaves the Vault locked.
4. Admit a new device using an existing trusted device or the tested recovery path. Inspect
   the device identity and pending request; approve, reject, expire or cancel it.
5. Inspect enrolled devices and revoke one. Show what future access stops, whether key
   rotation is needed, and that already copied plaintext cannot be recalled.
6. Recover on a clean trusted device, cancel before installing recovered state, verify the
   recovered contents, and retire lost-device trust. Lost factors without a recovery path
   have an honest unrecoverable outcome; account reset does not decrypt the Vault.

## Entry points, state and reverse actions

A trusted-client Vault home, device/security settings, lock shortcut and palette entry open
the same custody flow. Loom's ordinary UI may open the trusted client and show a coarse
availability result, but cannot accept owner factors or display recovery material. Inspect
pending enrollment/unlock/recovery operations, cancel them, close their UI and see the final
outcome after a lost response. Closing enrollment UI does not silently admit a device.

States: unsupported client, isolation unproven, uninitialized, setup incomplete, locked,
awaiting presence, unlocked, locking, suspended, device revoked, recovery required, damaged
storage and incompatible format. Lock on configured idle expiry, OS session lock and device
revocation; backgrounding/sleep policy is explicit and conservative. No ordinary Loom spinner
may imply an unlock happened merely because a request was accepted.

## Surfaces and connections

Mac plus iPhone is the first usable platform set confirmed by Kyle on 2026-10-21, with Safari
and Chromium browser support. A Mac running unrestricted agents as
the same principal is not automatically a trusted client: use a separate protected principal
or device unless a reviewed OS isolation proof supports the exact topology. Android,
Windows, Linux and browser-only custody remain tracked as unsupported until implemented.
Unsupported surfaces can inspect coarse capability state and instructions, never fall back
to server decryption. An offline enrolled client may unlock local encrypted data under its
local policy; unavailable online revocation checks must be disclosed, not called fresh.

## Decisions and open questions

Proposed: a maintained, reviewed engine and documented format; no Loom-designed cryptographic
scheme. Evaluate KDBX 4 compatibility first, including its limits for concurrent devices and
hardware unlock. This is a candidate, not a selected dependency or finished integration.

Kyle still needs to prioritize password/recovery factors, required offline behavior, trusted
Mac topology, device-loss recovery ownership and the first non-Apple platform. These answers
refine scope without removing the broader outcome. Critical personal custody needs independent
security review and recorded release evidence; docs, fixtures and harmless local UI work can
continue now.
