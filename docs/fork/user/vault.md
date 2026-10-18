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
`loom vault status`, `loom vault list` and `loom vault change` commands provide the same metadata and
lifecycle operations through an existing Loom connection.

This foundation does not yet route Git, SSH or runner launches through Vault. Adding an SSH key
record alone will not remove existing 1Password approvals. Broker enrollment is available below; credential delivery and authentication connectors remain
selected work in the Vault roadmap.

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
until a supported workload delivery channel is implemented. Pending checks can be cancelled.

Administrator CLI clients can use `loom vault grants`, `grant-preview`, `grant-apply`, `explain`
and `readiness` through the same services. Agent threads can inspect their own access and
delegate narrower grants to an authenticated direct subagent when allowed; they cannot approve
their own root grants. Normal responses contain references and safe metadata.

## Enroll an execution host

Open **Vault brokers** in the selected computer's Loom settings. On the intended macOS/Linux
execution host, run `loom vault broker identity` and enter its public key, name and platform in
**Enroll broker**. Download the invitation, transfer it to that host and run:

```sh
loom vault broker enroll --server https://your-loom-host.example invitation.json
```

Return to settings, refresh brokers and review approval. Compare the entire fingerprint with
the identity output on the intended host before approving. Then run `loom vault broker run` on
that host, or `loom vault broker check` for one check. Restart reuses the same identity. This is
a foreground process; automatic startup before login or after reboot is not configured.
For a source checkout, use `node apps/server/src/bin.ts` in place of `loom`.

An online heartbeat shows machine presence only. Enrollment does not grant access to Vault
items, route SSH through Vault or remove 1Password prompts. No personal key manager is needed
for the broker's identity. Stop the foreground process to stop renewals; presence lapses after
two minutes. Refresh settings to see changes. Offline credential use is unavailable.

Cancel an unused invitation or review **Disable** to permanently reject that machine identity.
To enroll again after disabling or losing a key, use a new private `--state-dir` outside the
working tree, generate a new identity and repeat approval. Disable does not revoke provider
credentials or erase copies held elsewhere. On mobile, invitations can be shared as public
challenge JSON; private keys always remain on the execution host.

## Check an authenticated workload channel

An agent in an active full-access/default Loom run can use `loom_vault_workload_open` with an
enrolled machine ID, item reference, exact destination and a separate workload public key.
Generate that key outside your project with `loom vault broker identity --state-dir
/absolute/private/workload-directory`. Use a different directory from the machine identity.
Never send private keys through tools or chat. An existing use grant is required; the tool
cannot grant access or choose another thread from a supplied ID.

Save the returned public session binding as JSON on the execution host, then check it with:

```sh
loom vault broker workload-check --state-dir /absolute/private/machine-directory \
  --workload-state-dir /absolute/private/workload-directory session.json
```

Keep the machine broker running so its heartbeat stays current. Both identities must match the
session. The check rechecks the current active run, runtime permissions and use grant; it
returns metadata with credential delivery unsupported. It does not log in to SSH or GitHub,
expose the stored value or grant a reusable token for a later operation.

Use `workload-release` with the same arguments, or the owning thread's
`loom_vault_workload_close`, to close the session. The owning thread can list its current-run
sessions with `loom_vault_workloads` if a response is lost. Sessions expire after five minutes
and are lost when the control plane restarts. Release/expiry does not delete your key files;
manage those private directories separately. A process with the same filesystem privileges
can read those files, so these checks do not provide OS-user/process isolation.

Automatic runner setup and actual credential delivery remain unfinished. Human administrator
clients and inactive or restricted threads cannot open workload sessions. Web, desktop and
mobile agents reach the same authenticated tools; no separate workload-management screen is
provided in this milestone.
