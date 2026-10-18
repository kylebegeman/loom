# Loom Vault

Vault stores development credentials and secure records separately from your personal accounts.
An administrator must connect the selected computer to an OpenBao service first.

In web or desktop, open **Settings → Loom → Vault** and select the computer you want to manage.
On mobile, open that computer's settings and find **Vault**. The computer owns the connection;
your phone or browser does not need OpenBao credentials. Servers without Vault support hide or
disable the controls.

Choose **Add item**, give it a name and kind, and enter its value. Secret values are hidden by
default. Multiline entry is explicitly visible, for keys and notes. File imports support files
up to 512 KB. Choose **Edit** to rename an item; enable **Replace value** only when changing its
contents. Values appear only after **Reveal value**, **Download** or **Share file**. Downloads
and shared copies leave Vault's protection once saved to another application.

Archive hides an item from the normal list. Enable **Include archived items** to restore it.
Delete removes its current value; encrypted previous versions and backups follow your backend's
retention policy. Delete does not revoke credentials at GitHub or another service. If an item
changes while you edit it, refresh before retrying instead of overwriting the newer version.

Inspection requires access to read this computer's credentials; changes and reveal require
write access. A locked, unavailable or misconfigured backend reports its state and can be
checked again with **Refresh**. Vault does not fall back to your personal password manager.

Agents with a manage grant can save values using Loom's private secret prompt and a one-use reference. Never paste
credentials into chat. Normal agent tools return metadata, not stored values. The authenticated
`t3 vault status`, `t3 vault list` and `t3 vault change` commands provide the same metadata and
lifecycle operations through an existing Loom connection.

This foundation does not yet route Git, SSH or runner launches through Vault. Adding an SSH key
record alone will not remove existing 1Password approvals. Enrolled brokers and authentication connectors remain selected work in the Vault roadmap.

## Grant recurring access

Open **Vault access** in the selected computer's settings. Add a grant for one thread or all
threads in a project, choose exact items and actions, and set its access window. A project grant
covers future threads in that project. Inspecting metadata, managing an item and using its
credential are separate permissions. Threads begin without item access; their grants cannot
increase the computer connection or runner permissions.

Review the preview before applying a change. You can abandon it without changing access.
Suspend a grant to pause it and resume it later. Revocation is permanent; restoring access
requires a new grant. Changes affect new online authorization. They do not erase values already
copied elsewhere or revoke provider credentials.

Choose **Why this access?** from an item, or **Vault grants and readiness** in a thread's command
palette. Select the thread, item, action and optional exact destination, then run the check.
The result explains the matching rule or denial and identifies unknown external consumers.
Readiness is checked in the Loom server context, expires after a minute, and must be repeated
after policy changes. It does not yet test SSH or GitHub; credential delivery reports unsupported
until a broker is implemented. Pending checks can be cancelled.

Administrator CLI clients can use `t3 vault grants`, `grant-preview`, `grant-apply`, `explain`
and `readiness` through the same services. Agent threads can inspect their own access and
delegate narrower grants to an authenticated direct subagent when allowed; they cannot approve
their own root grants. Normal responses contain references and safe metadata.
