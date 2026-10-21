# L107 implementation plan

## Before native work

Read [Personal Vault](../LOOM-PERSONAL-VAULT.md), the actual app/build config and current browser passkey code. Confirm the provisional first platform set with the owning task's priority answers. Keep Android/Windows/Linux/web tracked if first acceptance remains Mac+iPhone.

## Ordered steps

1. Inventory iOS extension targets, Android service generation, signed app identities/entitlements and minimum OS versions. Document which platform can supply password autofill, passkey create/get, TOTP and quick access. Do not infer provider capability from app login working.
2. Establish independently trusted native custody with a synthetic encrypted record and verified local unlock policy. Prove an agent with same-user host access cannot retrieve keys or drive private UI. Where that cannot be shown, disable personal reveal/fill and use an independent device. No live secret migration is needed.
3. Implement metadata-only contracts/capability state and native cancellation/lifecycle contracts. Verify the proposed shared personal primitive exists; consume its real interface or degrade honestly. Create missing shared seams separately rather than depending on a packet implementation order.
4. Add a fixture iOS password credential-provider path and OS-origin/app matching. Validate cancel, unlock failure, background lock, no matching/multiple accounts, provider disable and cache removal. Keep password material within native provider-to-OS delivery.
5. Add Android AutofillService fixture coverage separately from the Credential Manager provider track. Test Android version limits and app association, not just a React Native account picker. Unsupported targets advertise setup/status only.
6. Add desktop quick-access setup/shortcut and trusted-companion launch with no generic IPC. Implement local TOTP presentation and explicit clipboard cleanup in the trusted client. Preserve other clipboard content and cancel on lock.
7. Prove OS-owned passkey create/get against a fixture relying party, including allowCredentials, RP/origin and user-verification failures. Record actual custody/export/recovery properties. Keep Loom-managed portable keys visibly proposed until format, sync and native-provider decisions are reviewed.
8. Run focused tests and platform-native build checks, then an authorized integrated pass on the claimed OS/browser matrix. Add actual seam rows and task-focused help. Independent security review precedes critical personal custody; local fixtures do not require a separate approval ceremony.

## Done when

Each advertised provider actually fills or signs through the intended native OS path, cancellation/lock/revoke settle safely, no raw value crosses agent/environment/JS state, and platform limitations are visible. A passing OS ceremony does not count as a sync/export test. No platform is marked supported without its own evidence.
