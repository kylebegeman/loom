# Loom Vault

Vault stores development credentials and secure records separately from your personal accounts.
An administrator must connect the selected computer to an OpenBao service first.

In web or desktop, open **Settings → Loom → Vault** and select the computer you want to manage.
On mobile, open that computer's settings and find **Vault**. The computer owns the connection;
your phone or browser does not need OpenBao credentials. Servers without Vault support hide or
disable the controls.

## Choose personal or restricted access

For a computer you own and control, open **Vault**, confirm **This is my personal environment**
and choose **Enable owner access**. This is one setup action for that environment: authenticated
agents in active full-access/default runs can inspect metadata and use supported brokered
development connections without recurring thread, project or provider grants. New threads and
scheduled agent runs use the same policy. Profiles are optional saved selections.

The declaration applies to the selected environment, not your other computers. Loom does not
currently verify a separate platform owner for each person who can start an agent there. Keep
restricted access on a shared environment. Existing environments remain restricted until an
authenticated human administrator explicitly enables personal access. Choose **Use restricted
access** to disable it and return to grants. Later mode changes require the same human owner
identity that established the declaration. Enabling or disabling preserves encrypted items,
existing grants and recovery history; you do not need to recreate the Vault or import its
credentials again.

Credential availability does not authorize a task. Agents still follow your request and their
plan/runtime permissions. Personal access does not let an agent change access policy, approve
host trust, reveal or export stored values, or bypass one-time credential protection. It also
does not prove that a broker is online or that GitHub or an SSH host will accept a credential.
Disabling blocks new personal-mode authorization; an already authenticated connection may
continue, and completed remote effects cannot be recalled. Restricted grants can still allow
access after personal access is disabled.

## Manage records

Choose **Add item**, or **Add to Vault...** in the command palette, and enter a name and value.
To save a file, choose **Choose file** beside the value or drop one onto the Vault page on web/desktop.
Loom selects Secure file and uses the filename as the initial name. Secret values are hidden by
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

When answering a private secret request, you can select **Also save to Vault as** and enter a name.
This saves a separate Vault item using your own write access before answering the request.
If the save fails, retry or turn the option off to answer without a Vault copy.

Agents with a manage grant can save values using Loom's private secret prompt and a one-use reference. Never paste
credentials into chat. Normal agent tools return metadata, not stored values. The authenticated
`loom vault status`, `loom vault list` and `loom vault change` commands provide the same metadata and
lifecycle operations through an existing Loom connection.

Agents can now use the authenticated Vault SSH/Git tools described below after an administrator
configures this computer's execution broker and access policy. Adding a key alone does not route
ordinary terminal commands through Vault or remove their existing 1Password approvals.
Authentication connectors and general credential delivery remain selected work.

## Review temporary access requests

Open **Settings > Loom > Vault access > Remote approvals** on the computer whose credentials
will be used. The same inbox is available in mobile Vault access settings. Refresh to view
requests, inspect the thread, record, action and destination scope, then approve for five or
fifteen minutes, deny, or cancel. A destination shown as unrestricted permits any destination
for the selected action. Only a connection with access-management permission can decide.

Approvals expire automatically at the server. Use **Revoke approval** to revoke active or
expired approvals visibly. Other independent grants may still permit access. Pending requests
expire after ten minutes; ask again with a new request if needed. If a decision response is
uncertain, retry the same decision or refresh its status before deciding again.

Agents request access using the Vault access request tool and can inspect or cancel their own
pending request with its status/cancellation tools. A waiting-operation reference is linked to
the server's current run. If that run changes, request new access for the new work. An approval
never resumes a command or consumes a one-time permission; recheck access before explicitly
retrying work. Queue entries and retry evidence last 24 hours, with a 128-entry cap. Use fresh
request/operation IDs after that window. Encrypted backend history follows its separate retention
policy. There are no external notifications or automatic restarts yet. Approval
does not verify an external login or override runner permissions. Older servers without approval
support do not show this inbox.

## Import development records

Open **Vault development imports** in the selected computer's Loom settings or command palette.
On mobile, use that computer's settings. Enter one dedicated development secret or secure note,
confirm that it is separate from your personal accounts, and review the new record and selected
computer. Confirm the review separately to import. Preparation creates no Vault item and expires
after ten minutes. Existing records and repository settings are preserved.

Cancel a prepared review or clear private input to discard the local draft. Reopen a review to
refresh its status after a lost response; if it still needs input, reenter the same value.
Archiving from the review only affects the unchanged imported record. Restore it through Vault's
normal archived-item controls. Archiving does not revoke a provider credential or erase backend
history. Configure and verify a dedicated adapter before using the record in a project.

For SSH, prefer a fresh Vault key; for GitHub, use a dedicated App or token connection. This form
does not read 1Password, import exports, discover projects, verify logins or change Git/SSH
configuration. Administrator `loom vault migration-plans` and `migration-status` report safe
receipts; private imports use the reviewed form. Never put credentials in chat or command arguments.

## Import dedicated SSH and GitHub identities

Under **Vault development imports**, use **Typed development imports** for a credential created
specifically for development. Choose SSH key, GitHub token or GitHub App. Enter its explicit
destination or expected account/repositories and paste only that credential. SSH accepts
unencrypted Ed25519 PKCS#8 PEM or OpenSSH keys. Apps require an unencrypted RSA PEM key of at
least 2048 bits, plus App and installation IDs. Personal stores and files are never scanned.

Confirm development-only ownership, review the public scope and selected computer, then confirm
again to create one new item. Format checks are local; no host or provider is contacted. Account
ownership and access still need separate verification and current workload authorization. GitHub
API evidence cannot authorize Git transport changes. Closing clears private input; reopen the
review to reenter the same material. Cancel before commit, inspect an uncertain result before
retrying, or archive the unchanged imported item. Restore archived items through Vault
management. Cutover, rollback and configuration changes remain unavailable.

## Plan development replacements

Open **Vault migration plans** in the selected computer's Loom settings or command palette.
Inspect project dependencies, select a remote and choose an existing dedicated Vault SSH key
or GitHub connection. Confirm that it is dedicated to development, prepare the plan, then review
its scope and computer before recording your review. You can reopen, refresh or cancel a plan.
Reviews expire after ten minutes; changed project settings or record versions require a new plan.
Create fresh SSH keys or dedicated GitHub App/token connections in their existing Vault sections.

Inventory covers selected local Git settings in registered project roots, ten projects per page.
It reports sanitized endpoint hints and explicit fetch/push URL entries. Global and included
configuration, SSH aliases, environment overrides and account identity remain unknown. A missing
explicit push URL does not mean pushes have no credential dependency. Unsupported sources and
local rewrites need separate review. Inventory does not authenticate or inspect personal stores.

SSH plans cover mediated SSH Git operations. GitHub App/token plans cover API and `gh` operations;
they do not replace Git SSH/HTTPS authentication. Reviewing a plan changes no configuration, grants or profiles. To check access, record the
review first, then explicitly allow **Verify replacement access**. SSH reads refs from the exact
repository using the saved key and pinned host; GitHub checks repository API access, which does
not prove Git transport or local `gh` readiness. Missing SSH host trust blocks the check.

Refresh the verification receipt to inspect its evidence without contacting the provider.
Evidence expires within one minute, or earlier when the plan/token expires. Source/item changes,
cancellation or loss of permission during a check prevent usable success. Provider access can be
revoked after a successful check, and workloads still need current authorization under the
selected access mode. A lost response can be refreshed or retried without repeating an accepted
check. An interrupted receipt needs a fresh, explicitly confirmed attempt. Cancel the plan to
stop further credential use; an already started read may finish. **Cutover remains unavailable
even after verification.** Administrator CLI commands `loom vault migration-inventory`,
`migration-replacements`, `migration-replacement-status` and `migration-verification-status`
return the same safe reports; lists do not recheck source freshness until a plan is opened.

After a fresh successful SSH repository-read check, choose **Preview read cutover** or
**Preview rollback**. Each view covers the selected remote's fetch entry and shows the proposed
route through the dedicated Vault record. Refresh rechecks its evidence without contacting a
provider. Expired, changed or failed evidence blocks the preview. Close it or cancel the plan
to leave the review.

These views cannot apply changes. Push access and GitHub API checks do not qualify. Rollback
shows a hypothetical inverse, with original credential access unverified and no configuration
backup captured. It is not a recovery bundle. Ordinary terminal Git, personal SSH configuration,
workload grants and repository settings stay as they are.

## Verify an original development route

Open a reviewed SSH fetch replacement plan and use **Original development route**. Select a
separate original development SSH record already in Vault. Its user, host and port must match
the explicit source URL, with pinned trust and access to the exact repository path. Review the
selection, then separately allow the repository-read check. Missing trust blocks before SSH
access. Refresh inspects its receipt without contacting the provider again.

This verifies the selected development key. It does not identify the key an old terminal used,
resolve SSH aliases/defaults or contact a personal key manager. Do not supply personal or
production credentials. Workloads still need current access, and provider access can change
after a check. GitHub API evidence cannot substitute for Git transport evidence.

With fresh successful original and replacement receipts, choose **Preview recovery snapshot
design**. It describes proposed bounded capture and recovery safeguards. Nothing is captured or
written, and no backup exists. Close the design or cancel the plan to leave it. Real capture,
cutover and rollback execution remain unavailable.

## Grant recurring access

Use recurring grants for shared or restricted environments, or for actions personal access does
not include. Personal owner-trusted inspect and brokered use do not need these grants.

Open **Vault access** in the selected computer's settings. Add a grant for one thread or all
threads in a project, choose exact items and actions, and set its access window. A project grant
covers future threads in that project. Inspecting metadata, managing an item and using its
credential are separate permissions. In restricted mode, threads begin without item access;
grants cannot increase the computer connection or runner permissions.

Review the preview before applying a change. You can abandon it without changing access.
Suspend a grant to pause it and resume it later. Revocation is permanent; restoring access
requires a new grant. Changes affect new online authorization. They do not erase values already
copied elsewhere or revoke provider credentials.

In an environment migrated to mandatory credential protection, neither personal access nor
ordinary grants can bypass
one-time protection. Protected or unclassified credentials currently refuse use, including
manual reveal and probes, while exact-operation review and execution remain unavailable.
Existing environments keep their current timed-access behavior until a reviewed migration.

Choose **Why this access?** from an item, or **Vault grants and readiness** in a thread's command
palette. Select the thread, item, action and optional exact destination, then run the check.
The result explains the matching rule or denial and identifies unknown external consumers.
Readiness is checked in the Loom server context, expires after a minute, and must be repeated
after policy changes. It can report current run access and relevant enrolled-broker presence,
but does not perform an upstream SSH or GitHub login. Use the supported connection-specific
check or signed operation to verify that destination. Pending checks can be cancelled.

The access inspector also shows related project profiles, the current provider/run, observed
workload and broker sessions, and retained requests for the selected item and thread. Context can
be partial and expires; refresh it before relying on labels. An empty list does not establish that
there are no consumers. External credential copies remain unknown, and this view grants no access.

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
that host, or `loom vault broker check` for one check. Restart reuses the same identity.
For a source checkout, use `node apps/server/src/bin.ts` in place of `loom`.

For background operation, run these commands on the execution host using the absolute path to
its installed Loom launcher:

```sh
loom vault broker service plan --executable /absolute/path/to/loom
loom vault broker service install --executable /absolute/path/to/loom
loom vault broker service start
loom vault broker service status
```

Use the same `--state-dir /absolute/private/directory` on every command if enrollment used a
custom directory. Inspect the plan before installing. Installation enables startup in the user's
service session; start runs it now. macOS requires a logged-in user. Linux/Pi needs an available
systemd user manager; continuity after logout or boot additionally requires operator-configured
linger. Status reports autostart, session continuity, process state and the last heartbeat
separately. A running process can still be disconnected or waiting for OpenBao to be unsealed.

Use `service stop` to stop renewals, `service restart` to retry after repairing configuration,
and `service uninstall` to remove startup registration. Uninstall retains enrollment so a later
installation can reuse it. Disabling the broker in Loom remains permanent for that identity.
Outages and sealed OpenBao retry automatically; a disabled identity stops. Local broker keys
require no personal key-manager unlock, but remain readable by processes with the same OS
permissions. Configure backend unlock on the Loom control plane.

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
Never send private keys through tools or chat. Current use authorization is required: personal
owner-trusted access or a matching restricted grant. The tool cannot grant access or choose
another thread from a supplied ID.

Save the returned public session binding as JSON on the execution host, then check it with:

```sh
loom vault broker workload-check --state-dir /absolute/private/machine-directory \
  --workload-state-dir /absolute/private/workload-directory session.json
```

Keep the machine broker running so its heartbeat stays current. Both identities must match the
session. The check rechecks the current active run, runtime permissions and access policy; it
returns metadata with credential delivery unsupported. It does not log in to SSH or GitHub,
expose the stored value or grant a reusable token for a later operation.

Use `workload-release` with the same arguments, or the owning thread's
`loom_vault_workload_close`, to close the session. The owning thread can list its current-run
sessions with `loom_vault_workloads` if a response is lost. Sessions expire after five minutes
and are lost when the control plane restarts. Release/expiry does not delete your key files;
manage those private directories separately. A process with the same filesystem privileges
can read those files, so these checks do not provide OS-user/process isolation.

Hosted SSH/Git tools below perform their own workload setup automatically. General terminal
setup and other credential-delivery modes remain unfinished. Human administrator clients and
inactive or restricted threads cannot open workload sessions. Web, desktop and
mobile agents reach the same authenticated tools; no separate workload-management screen is
provided in this milestone.

## Manage SSH keys and test a connection

In the selected computer's Vault settings, choose **Create SSH key**, enter its development
host, SSH user and port, then copy the generated public key for registration on that host.
The private key stays in Vault. Existing SSH items offer **Manage SSH key**. On web/desktop,
**Manage Vault SSH keys** in a thread's command palette opens that computer's Vault settings.
On mobile, expand the sheet when you need more space for the form.

Verify the host's Ed25519 public-key fingerprint through an independent trusted channel.
Paste that public key, review the proposed fingerprint and confirm before saving. A key scan
alone does not establish trust. **Remove host trust** requires confirmation and blocks new
connections; save a verified pin later to restore access. Archive/restore uses the normal
item actions. Removing trust or archiving does not unregister the public key on the host.

Use **Find pinned keys on this computer** to read the selected computer's configured SSH known-hosts files.
When a matching Ed25519 key exists, review its source file and fingerprint, then choose
**Use pinned key from this computer** and confirm the fingerprint. Global pins are labeled separately
from user known-hosts entries, which may have been accepted on first use. This reads the computer
running Loom, including when you connect from a phone; it does not scan the remote host.

After registering the public key and saving host trust, choose **Test SSH connection**.
Loom runs a fixed harmless command from its server, using this key and pinned host. Success
names the tested item version. The target must be reachable from that server and support
Ed25519 host keys and OpenSSH host-bound authentication. Unsupported hosts and authentication
failures report an error. Key changes invalidate earlier test evidence. Changes and tests
require Vault write access; public inspection and copying require read access.

Administrator MCP/CLI clients can use `loom_vault_ssh_probe` or `loom vault ssh-probe` with the
item ID and current `expectedVersion`. Agent threads cannot invoke this administrator test.
It does not configure Git, attach credentials to Pi or grant an agent access. General
readiness stays separate. Existing 1Password prompts continue until those consumers are wired.

## Select a connection by resource name

Ask the agent to use a saved resource, such as “use personal-vps” or “use this repository's
GitHub connection.” A project profile is optional. The agent can resolve the saved item by
name, host, repository or account metadata, then use its selected identity and current version.
If several compatible connections match, choose the intended account or key before proceeding.
Execution checks the selected version, destination and current access again; it does not switch
to another credential after a failure.

From an authenticated agent terminal, the same lookup is available through:

```sh
loom vault connections-resolve '{"kind":"ssh","connection":{"resource":"personal-vps"}}'
loom vault connections-resolve '{"kind":"github","connection":{"resource":"owner/repo"},"repository":"owner/repo"}'
```

Agents can use `loom_vault_connections_resolve` with that input, then call the direct SSH/Git/
GitHub tools with the returned item ID/version. Supported direct execution tools also accept
`connection:{"resource":"personal-vps"}` in place of the explicit item/version. A Git operation
still needs its repository; GitHub still enforces the connection's repository allowlist.

A result with no visible match can mean the record is absent or hidden by restricted policy.
Check the selected computer and inspection access before creating a duplicate. A policy denial
needs the matching restricted grant or a review of personal setup. An untrusted SSH host needs
independent host verification; a missing/offline broker needs broker setup. Backend lock or
outage and an upstream login failure are separate repairs. Resolution checks configuration and
policy; it does not contact the host or prove current broker or upstream readiness.

## Use Vault from an agent or scheduled run

Ask an active Loom agent to use the selected resource with `loom_vault_ssh_exec`, or
`loom_vault_git` to list remote refs or fetch a development repository. Explicit item ID and
current-version inputs remain supported. The computer's administrator first enrolls and
configures its execution broker, keeps it online, and authorizes personal owner access or
restricted permission for the selected item and exact destination. The agent cannot approve its
own key, host trust or root grant. Full-access/default mode is required.

Loom automatically creates, signs and releases the workload for each operation. No session file
or workload-key transfer is needed. It executes on the selected Loom server. Pi, Codex and other
providers use their existing authenticated Loom tools; web, desktop and mobile agents reach the
same service. Scheduled agent runs use the same permissions. In restricted mode, a project grant
can cover new scheduled threads; a thread grant covers only that thread. Command-only jobs do
not inherit this agent access.

For Git, supply a repository path on the key's host, such as `team/repo.git`, with action
`ls-remote` or `fetch`. In restricted mode, grant its exact Git destination, for example
`git+ssh://git@dev.example.test:22/team/repo.git`. An absolute `/srv/repo.git` uses
`git+ssh://git@dev.example.test:22/:absolute/srv/repo.git`. The ordinary SSH destination grant
does not automatically grant these Git destinations. Git runs in the current thread checkout.
Fetch updates objects and `FETCH_HEAD`; it does not merge, change origin or configure tracking.
Clone, push and submodules are not available through this tool yet.

The authenticated CLI offers the same operations. For example, from an active agent's
existing Loom connection:

```sh
loom vault git '{"id":"your-item-id","expectedVersion":2,"repository":"team/repo.git","action":"fetch","timeoutMs":30000}'
```

Replace the ID with the actual item reference and use its current version. Do not pass a
backend token or private key. Git results include `exitCode` and bounded `stdout`; inspect
the exit code even when the CLI successfully prints JSON. A successful fetch can have no
standard output. Hosted Git is limited to 30 seconds and 64 KiB stdout; SSH uses 8 seconds
and 2 KiB. Do not print secret remote values. Cancelled or lost responses can follow a
completed operation, so check its state before retrying.

Unconfigured/offline brokers, missing grants, changed versions and untrusted hosts report an
error. Request the corresponding administrator change rather than falling back to personal
credentials. These tools do not configure the terminal's SSH agent or ordinary `git fetch`;
those commands can still invoke 1Password until separately routed. Personal credentials stay
separate. A process with the same OS permissions can still read broker identity files.

## Run a mediated SSH command

Loom can run a bounded SSH command from its server using a dedicated Vault key. The target
must be reachable from that server. This does not configure Dorothy's local SSH agent, rewrite
Git remotes or attach credentials automatically to Pi or other providers.

Use an authenticated full-access administrator MCP client for `loom_vault_ssh_generate` and
`loom_vault_ssh_trust`, or the corresponding `loom vault ssh-generate` and `ssh-trust` commands.
Agent threads cannot create keys or approve host trust. These commands reuse the CLI's existing
MCP connection environment; never put an authorization token in command arguments or chat.

For example, create a key with no trusted host yet:

```sh
loom vault ssh-generate '{"id":"11111111111111111111111111111111","operationId":"22222222222222222222222222222222","label":"Development SSH","target":{"hostname":"dev.example.test","username":"loom","port":22,"hostKey":null}}'
```

Choose fresh IDs for each key and mutation; retain them for retries. The result contains only
public metadata. Copy the public key for registration on the development host. Verify the
host's Ed25519 public key independently, then use `ssh-trust` with the item ID, current
`expectedVersion`, a new `operationId` and that public `hostKey`. Unverified key scans are not
trust approval. `ssh-info` with `{"id":"your-item-id"}` returns public identity, destination,
fingerprints and the current item version. Threads need inspect access under the selected mode.

Set `hostKey:null` through `ssh-trust` to remove trust without replacing the user key. You can
restore a verified pin later. Archive/restore/delete use the ordinary Vault item actions.
These actions stop future authorized use; removing a public key from the remote host and
revoking external copies remain separate work.

In restricted mode, grant the active thread `use` access to this item and its exact destination.
Enroll its machine, keep its heartbeat running and open a workload session as described above.
Save that public session JSON on the runner. Create a command file containing the current key
version, a harmless argv and a timeout, for example:

```json
{ "expectedVersion": 2, "argv": ["/usr/bin/printf", "Loom SSH is ready"], "timeoutMs": 8000 }
```

Execute with the machine identity and separate workload identity:

```sh
loom vault broker ssh-exec --state-dir /absolute/private/machine-directory \
  --workload-state-dir /absolute/private/workload-directory session.json command.json
```

Loom signs this exact command request and rechecks policy, host presence and key version.
Only macOS/Linux servers with compatible OpenSSH host-bound authentication and Ed25519 host
keys are supported. There is no password, personal-agent, host-key bypass or forwarding fallback.
IPv6 targets, SSH aliases and certificates are not implemented. Keys stay in OpenBao/server
memory; the SSH operation writes only public identity/host-trust files and removes its local
resources afterward.

Commands are limited to eight seconds, 2 KiB stdout and four concurrent executions. The CLI
prints JSON with `exitCode` and `stdout`; inspect the remote exit code, since it is not used as
the CLI process exit status. SSH failures fail the CLI. Do not place credentials in argv or
print sensitive remote values. Timeout, cancellation or a lost response can leave remote
effects, and a fresh retry can repeat them. Revocation blocks new authorization/signatures;
it cannot undo an already authenticated command. Release the workload session when finished.

## Use SSH and Git from an agent terminal

Use explicit terminal activation when ordinary SSH/Git output or commands are needed on the
invoking host. Pin the host's verified Ed25519 key. In restricted mode, the administrator must
grant the selected key for its SSH host destination, such as `ssh://git@dev.example.test:22`. A
repository-only Git grant uses the hosted `loom vault git` path instead.

From an active full-access/default agent terminal, replace the item ID, version and host with
the managed key's current details:

```sh
loom vault ssh-agent-exec '{"id":"your-item-id","expectedVersion":1,"timeoutMs":30000,"command":{"tool":"ssh","argv":["git@dev.example.test","uname -a"]}}'
loom vault ssh-agent-exec '{"id":"your-item-id","expectedVersion":1,"timeoutMs":30000,"command":{"tool":"git","argv":["fetch","origin"]}}'
```

Git clone/push and other ordinary Git argv also use this command. The key's host, user and port
must match the SSH remote; existing remotes are retained. Direct SSH supports the pinned host,
optional matching `-p`/`-l`, `-T` and verbosity flags. Forwarding, proxy/config overrides and
interactive authentication are unavailable. Each child gets temporary configuration and one
agent; its output and exit status are preserved. The command runs in that terminal's current
checkout and connects from that host, which may differ from the Loom server.

Pi and ACP use their existing terminal MCP connection. Other native harnesses need an explicit
`LOOM_MCP_ENDPOINT` and `LOOM_MCP_AUTHORIZATION` pair configured privately in the terminal, or
can continue using their existing hosted MCP tools. This command requires an authenticated
active agent run; an unrelated shell or context-free scheduled command does not gain access.
Never paste connection credentials into a prompt or command argument.

Each activation expires within five minutes. Completion or cancellation cleans the local agent;
Ctrl+C stops its child. Inspect with `loom vault ssh-agents` and close an owned reference with
`loom vault ssh-agent-close '{"sessionId":"your-session-id"}'`. Closing or revoking prevents
new signatures; an already authenticated remote connection or its effects may continue. If the
server cannot be reached for close, the server reference expires. No surrounding shell or
personal SSH configuration is changed, and private keys stay in Vault's control plane.

## Find references and configure a project profile

In web or desktop **Settings → Loom**, use **Vault references** to search names or item IDs
and copy a stable reference. On mobile, open **Settings → Computers → Manage computer** and
use **Vault references**. Choose **Search on computer** to inspect another connected computer's
records. Each computer requires its own inspection permission and reference-search support;
switching computers clears the current search. This does not move credentials or project bindings.
References contain no credential values and grant no access. Use **More references** when a sparse search page has no matches but more records remain.

Open **Vault project profiles**, choose the destination computer and project, and create a
profile with named SSH, Git or GitHub requirements. Choose an SSH key for SSH/Git and, for Git,
its exact repository path. For GitHub operations, choose a dedicated connection and one of its
allowed repositories. Switching operation kinds clears the previous binding. Review with a
project thread to check its current access; **Host checks only** does not prove that a thread
can use the key or connection. You may save an incomplete profile for later repair. Edit to
replace/unbind keys or remove requirements; clone to start another profile without copying
secret values.

Set a profile as the default for new run resolutions, or clear the default. A run keeps the
profile revision and key versions it first resolves. Later edits/default changes apply to later
runs. A changed key or connection version requires a new run. Current policy, host trust and
item state still apply. Archiving blocks further profile use and clears its default; restoring
does not select it again. Profile selection grants no access and never changes your personal SSH
agent.

Agents use `loom_vault_profiles`, `loom_vault_profile_resolve` and `loom_vault_profile_run` for
their own project. A named SSH/Git operation automatically uses the configured server broker
and closes its operation session. Administrators manage bindings; agents cannot approve their
own access or change profiles. The CLI exposes `loom vault references-search`,
`references-describe`, `profiles`, `profiles-apply`, `profile-resolve` and `profile-run` through
the existing authenticated tool path. Agent-only resolve/run commands require a running thread.

Explicit launch attachments are described below. Automatic profile selection without an attachment is still pending.
Profiles support SSH commands, Git ref listing/fetch and the documented mediated GH operations,
with existing output and time limits. GitHub uses the dedicated connection without an SSH broker. It does not configure ordinary terminal SSH/Git commands or deliver raw values.

## Attach Vault requirements before an agent run

Existing prompts and scheduled tasks can contain readable Vault reference or versioned profile
links with no credential values. Edit or delete their lines directly in the prompt. Keep
attachment links on their own lines; inline or quoted examples are not requirements.

A profile requires a full-access/default agent run. Every required SSH/Git binding must have an
active key, verified host trust and current use authorization. GitHub bindings need an active
connection and repository access within its allowlist. Restricted mode requires matching grants.
A reference alone requires active metadata and inspect access; it grants no credential use.
Host-only review for a new scheduled thread does not prove its access. In restricted mode, grant
the project deliberately when future scheduled threads need access. Editing a profile requires
reviewing and attaching its new version before a later run can start. Existing runs retain their
pinned configuration; current access policy still applies.

Invalid, missing, changed or denied requirements produce **Vault launch blocked** in the thread
before the provider opens. Repair the binding/grant or edit the prompt, then retry. Steering
also checks explicit attachments and cannot switch an existing run's pinned profile. Scheduled
agent runs follow the same checks. Newly fired tasks with Vault attachments show their latest
provider run as running, failed or completed. A blocked run remains failed even when the prompt
was dispatched successfully. Review the task's attachments, repair access and explicitly retry;
on mobile, tap the task to edit it, save, then choose **Run now**. Webhooks require a new request
after repair. Runs fired before this tracking was available retain their dispatch status.
Command-only jobs and upstream servers without attachment support do not perform these Vault checks.

## Share requirements without sharing local bindings

In **Vault project profiles**, export or copy a profile's requirements. The declaration includes
its label and SSH/Git/GitHub requirement names and kinds. Review those labels before sharing.
Keys, connection IDs, repositories, grants, defaults and run selections stay on the source computer.

On the destination computer, choose a project and **Import portable requirements**. Paste the
declaration, review the fresh profile and choose local keys/connections/repositories. SSH/Git-only
exports use version 1; GitHub exports use version 2 and require GitHub profile support on the
destination computer. You may save
it unbound for later repair. Importing does not replace an existing profile, change its default
or grant access. Cancel editing to discard the import; archive a saved profile when finished.

For automation, `loom vault profile-requirements` exports through the authenticated connection.
A human administrator can use `profiles-apply` with `change.type: "import"`, a fresh `id` and
`declaration`, plus the current registry revision and operation ID. Agents may export their own
project's requirements but cannot import or edit bindings. Additional credential kinds and automatic
Library/project-file distribution are not available yet.

## Inspect and retire old run selections

Choose a project in **Vault project profiles**, then inspect **Retained run selections**.
The list shows the selected profile revision, binding/key versions, destination and run.
Older records may have no selection time. Only confirmed terminal runs can be retired;
active or unavailable runs remain retained.

Retirement requires confirmation and cannot be undone. It clears the current binding snapshot
and keeps a tombstone so the same run cannot select different credentials later. Start a new
run when new selection is needed. OpenBao version history, credentials and grants remain.
This is not secure erasure or remote credential revocation. Human administrators can also use
`loom vault profile-pins` and `profile-retire`; agents cannot retire their own selections.

## Connect GitHub and approve project access

Open **Settings → Loom → GitHub for agents (Vault)** on web/desktop, or **GitHub for agents (Vault)** under
**Settings → Computers → Manage computer** on mobile. Save a dedicated fine-grained token
or choose a GitHub App under **Advanced connection settings**. Paste GitHub repository URLs
or `owner/repository` names. Loom verifies the account and API access before saving.
Personal owner-trusted environments support up to 100 repositories per connection; restricted
environments support 32. When editing repositories or the name, leave the credential blank
to keep it. Enter a credential only when replacing it.

The token form links to GitHub and lists the required repository permissions. Choosing
**All repositories** on GitHub chooses repository coverage; it does not add permission entries.
For development, set **Contents** and **Pull requests** to read and write, and **Actions** and
**Commit statuses** to read-only. Metadata is included automatically. Organizations may require
separate approval. App setup needs its App ID, installation ID and RSA private key.

In restricted mode, choose **Configure project access** on the saved connection, then **Find
matching projects** to suggest repositories from registered projects' local Git metadata. Review
the detected set; a project name can differ from its repository name. Search for additional
projects and choose their repositories from this connection's allowlist. Matching never
authenticates or changes Git configuration. If metadata is unavailable or incomplete, select
missing projects manually.

Review and approve all selected projects together. The default is recurring access until revoked;
the web form also offers a fixed duration. This authorizes every thread in each selected project
to use only its chosen repositories and inspect connection metadata. It does not allow changing,
revealing or exporting the saved credential. Names, exact destinations and separate metadata
permissions are generated for you. The full selection saves in one operation; a stale review
must be refreshed before approval. Existing connections and grants remain usable.

Saved project access appears on the connection. Choose **Revoke project access** to review
removal; custom delegated grants may need review in advanced Vault access. Removing Loom access
does not undo completed GitHub operations or revoke credentials already issued by GitHub.
Temporary run-bound requests remain separate and are not needed for recurring project setup.

Open the saved connection's advanced tools to replace credentials, test repository API access,
or inspect runtime readiness. A saved connection and current policy authorization are separate
from a successful current-run check: API, GH CLI and Git HTTPS must each pass for that run.
Disconnect blocks new Loom use; revoke the token or App installation at GitHub separately to
stop issued credentials. Older computers without bulk-access support prompt for an update.

Agents use `loom_vault_github` with the connection ID/version, repository and a documented
operation. An active full-access/default run and current use authorization are required. In
restricted mode, use requires an exact grant for `https://github.com/owner/repo`. Available
actions read repositories, PRs, issues and PR checks, add comments or create issues. Inspect
`exitCode`; after a timeout or uncertain write, check GitHub before retrying. Administrators can
use `github-connections`, `github-info`, `github-test` and `github-change` through the
authenticated CLI. Agent execution requires a running thread. No command accepts raw GitHub
tokens from chat.

These mediated GH operations use temporary private configuration on the Loom server. They do
not log into your personal account, configure ordinary terminal gh/Git HTTPS or change SSH
remotes. GitHub Enterprise, OAuth/device onboarding and other service connectors are not
available in this milestone. Project profiles can bind a GitHub connection/repository explicitly.

## Use a named GitHub profile binding

Choose **GitHub operations** for a profile requirement, then select a dedicated connection and
an allowed repository. You can unbind or replace it later. Review checks saved configuration and
the selected thread's current access policy. Host checks alone do not prove a thread can use the
connection; neither review nor launch preflight tests live GitHub API health or GH CLI
installation.

Attach the reviewed profile in the composer or scheduled prompt. A new run pins its connection
version and repository. Current access policy, repository allowlist and connection/profile state
still apply. Replacing credentials requires a new run; changing a profile requires reviewing its
new version before attaching it to later runs. Configuration or access failures block launch.

An agent can call `loom_vault_profile_run` with the binding name and, for example,
`operation:{"kind":"github","operation":{"action":"pr-list"}}`. The authenticated CLI
`loom vault profile-run` uses the same input and needs a running agent thread. The profile
supplies the pinned item/version/repository. This runs through isolated server-side GH and
inherits its limits and inspect-before-retry rule for uncertain writes. It does not configure
ordinary terminal gh/Git HTTPS or your personal credentials.

## Route a terminal command through Vault

In **GitHub access**, choose the repository and copy the terminal command. Run it
from an authenticated Loom agent terminal. It names only a connection reference and version;
never paste a credential into the command. The command runs on the Loom server in the active
thread's checkout, including when you control it from another computer or phone.

For example, replace the reference below with your saved connection, then choose the normal
command arguments. The wrapper forwards output and the child's exit status:

```sh
loom vault github-exec '{"id":"<connection-id>","expectedVersion":1,"repository":"owner/repo","command":{"tool":"gh","argv":["pr","list","--state","all"]}}'
loom vault github-exec '{"id":"<connection-id>","expectedVersion":1,"repository":"owner/repo","command":{"tool":"git","argv":["fetch","origin"]}}'
```

Supported GH families are `repo view`, PR list/view/checks/diff/create/comment/close/reopen/
merge/ready/review, issue list/view/create/comment/close/reopen, release
list/view/create/edit/upload/download, workflow list/view/run, and run
list/view/watch/rerun/cancel. Use numeric PR/issue/run references and explicit release tags
or workflow filenames. For workflow inputs, use `-f key=value` or `--raw-field key=value`.
Release creation requires explicit notes or a notes-generation option and verifies that the
source tag already exists. Release assets and notes files must be literal paths inside the
active checkout. Release downloads require `--dir` naming an existing empty directory inside
that checkout. File patterns for uploads, stdin, tag replacement and file-based workflow
inputs are unavailable. Git supports `ls-remote`, `fetch`,
`push` and `clone`, with the selected HTTPS URL or `origin`. For clone, use the selected URL
and optionally a new directory name under the checkout. `origin` means the selected Vault
repository for this command; fetching it without refspecs updates its remote-tracking branches.
Stored remotes and the surrounding shell's account stay unchanged. Account-login commands,
interactive flags, extensions, other destinations and custom executable transport flags fail
with guidance. A repository with custom credential, HTTP, URL-rewrite or executable settings
must have those settings reviewed and removed before routed execution.

Each invocation needs a current connection version and authorized repository access for the
active full-access/default thread. Restricted mode requires a matching use grant. The CLI uses
its authenticated MCP connection through `LOOM_MCP_ENDPOINT`/`LOOM_MCP_AUTHORIZATION`, or the
existing ACP MCP environment. Native agent MCP callers can use `loom_vault_github_exec` directly
when terminal connection variables are not supplied by their harness. Never transfer that
authorization through chat. There is no persistent shell activation, personal-login fallback or
automatic SSH remote conversion. After a timeout, cancellation or an uncertain write outcome,
inspect GitHub before retrying.

## Check GitHub execution readiness

Choose **Check GitHub readiness** in the same connection section on web/desktop or mobile.
The default checks the selected identity's API access, GH CLI repository read and Git HTTPS
ref read on the Loom server. Select a thread to check its current run and repository access;
a denied/inactive thread skips provider probes. A result names the server execution context,
separates each check, and expires after 60 seconds. Cancel a pending check or run it again after
repairing credentials, tool installation, permissions or network access.

Host-only results leave run access unchecked. Checks do not prove every write permission,
an independently configured provider terminal, SSH readiness or another runner's environment.
Agents can call `loom_vault_github_readiness` for their own thread; administrators can use
`loom vault github-readiness` with the connection/version/repository and `threadId:null` or a
selected thread. A successful check grants no later access; execution checks authority again.

## Native agent terminals

Loom prepares terminal access automatically for Codex and Claude sessions. Run
`loom vault terminal-readiness` from the agent's terminal to check its current connection,
provider/run and online broker presence. Restart the provider session if the connection is
missing or stale. No manual MCP token setup is needed for these sessions.

Continue using explicit `loom vault github-exec` or `loom vault ssh-agent-exec` commands with
a selected item, current version and destination. Readiness does not grant access or establish
that GitHub/SSH authentication will succeed. Other shells do not automatically acquire the
agent session's access. Pi and ACP use the connection attached to their own sessions.

## Maintenance inbox

Open **Settings → Loom → Vault maintenance**, or search for “Vault maintenance inbox” in
the command palette. Review expiry warnings and failed development access, recheck a configured
item, snooze it for a day, dismiss a stale warning or reopen it. Review access to inspect the
item's grant and destination. An outage warning does not mean the credential was revoked.

Outage reports with the same recorded GitHub service or SSH host and port appear together.
Each item keeps its own recheck, snooze and dismiss actions. A shared destination does not prove
a shared cause; one item recovering does not clear the others. Older reports without a recorded
destination remain individual.

Choose a Vault item and declare its expiry, optionally adding a dedicated GitHub repository
for validation. Enable automatic checks explicitly; otherwise checks run only when requested.
Warnings begin seven days before declared expiry. Recent checks can be rate limited, and an
item without a rule must be configured before rechecking. Removing a rule stops future automatic
checks. Health actions never sign into personal accounts, rotate credentials or retry writes.

From a maintenance issue, choose **Show project references** to inspect current project profiles
and grants that name the item. **More projects** checks the next ten projects; a page with no
references does not establish that later projects have none. Review a project's profiles to
change its bindings, or review grants before changing authority. Archived profiles and inactive
grants keep their state labels. Coverage states what the current page inspected. Grants whose project or thread no longer exists are counted separately across the environment; use **Review unattributed grants** to inspect them. These references do not prove working access.

Under **Retained run selections**, choose any project on the current page, including one with
no current references. Matching selections show the earlier profile and item versions they
pinned. Continue through pages even when a page has no matches. Retired selections whose
binding snapshot was removed are counted as unattributable. Review the project's run selections
to inspect or retire a stopped selection; current backend checks still decide whether retirement
is allowed. Consumers outside Loom are not discovered, provider-held credential copies remain unknown, and these inspections do not evaluate current access. An older server that omits coverage shows that limit explicitly. An empty final page does not prove the item is unused.

For an SSH key, **Validate SSH connection** checks its saved destination with the pinned host key
and a fixed no-op command. Saving this rule does not run the check unless automatic checks are
also enabled. Use **Check selected item** for an explicit check. An untrusted host or failed SSH
connection appears as a configuration issue; a timeout appears as an outage. Neither proves key
revocation. Disable SSH validation and save the rule to keep expiry-only maintenance.

Agents can use `loom_vault_access_retry_prepare` to check a proposed SSH, Git-over-SSH or GitHub
API operation against their own approved, run-bound request. Supply the request revision and
waiting-operation reference. Keep the returned operation digest to compare the same proposal
after a reconnect. Preparation never runs a command or grants access; normal operation checks
still apply. If a previous write may have run, inspect its outcome before retrying. The digest
is comparison metadata, not proof that a command ran or permission to replay it. Follow the
returned repair step: wait for a decision, refresh changed context, review a changed operation
or inspect a possibly completed write. A backend outage requires a fresh check after recovery.
Automatic resumption and one-time approval consumption remain unavailable.

The approval inbox also shows notification status. External alerts are not connected yet;
requests remain available here regardless of that status. Delivery observations reset with the
server session. “Unconfirmed” does not mean an alert arrived, and a delivery receipt would not
mean someone reviewed or approved the request. Refreshing or restarting does not resend alerts.

Agents can inspect the same notification observation through their own request-status tool.
If saving a request loses its reply, look it up by the original ID before retrying. A saved
request may have no recorded delivery attempt; replaying creation returns that request without
sending an alert. Status remains available only during the request's retention window.

For an operation with uncertain history, an agent can use `loom_vault_access_recovery_status`
with its original request ID. It shows only that thread's retained journal summary alongside
current request status. A reservation or unknown outcome means inspect what happened before
proposing more work. Retry preparation includes this history check: a caller's “not started”
claim cannot override a reservation or completed result, and a changed command cannot reuse a
saved preparation digest. Cancelled preparation needs a new request and operation reference. Missing evidence does not prove nothing ran. This check never runs or
resumes an operation, changes a reservation or grants access. Journal errors leave ordinary
approval review available.

The inbox starts with pending requests. Choose **Show all requests** to review retained decisions
or revoke an active or expired approval, then **Show pending requests** to return. Counts and
visible pending work update at expiry; server-side checks remain authoritative.

Approval cards show current record, thread and project names alongside the IDs and version
requested. Review those details and the destination before deciding. Changed or unavailable
context requires refreshed review; you can still deny or cancel the request. On an older server,
IDs remain available even when names are not. Names do not verify an external account's identity.

## Keep dedicated test accounts ready for QA

In Settings > Loom > Vault test accounts, create a collection for an app and its development,
staging or test environment. Add a reference to a dedicated **Account** item already stored in
Vault. Confirm it is separate from personal and production accounts, then review it clean before
reserving it. The account picker searches names; passwords stay in the original Vault item.

A reservation belongs to your current Loom connection. Release and expiry put the entry in
quarantine until you reset or independently check it and mark it clean. You can renew a live
reservation within its one-hour maximum, retire an entry, or restore it to quarantine. If your
connection is replaced, an authorized manager can quarantine its abandoned reservation.

This first version manages the account pool. It does not provision/reset accounts, log a test
worker in, or revoke existing application sessions. Reserving grants no extra Vault access.

Agents need an active full-access/default Loom root run, including queued follow-ups and pending
approval/user-input requests while that run remains active. Leases end when the root run ends,
including a waiting thread with only background subagents. Those subagents cannot retain or
renew the old lease; use a new root run or a separate manager-owned reservation. Supervised and
plan-mode runs cannot discover or mutate account reservations. Use
`loom_vault_test_accounts_discover` to find available accounts and their own run's reservations.
In restricted mode, grant both inspect and use for the relevant Account items, scoped to the
copyable **Agent grant destination** shown for each collection in web and mobile
(`loom:test-accounts:<collectionId>`) when access should cover only that pool. They can reserve,
renew or release with `loom_vault_test_accounts_apply`; they cannot mark an account clean or
grant themselves access. Reservations belong to that run. Stopping or replacing it, or
withdrawing access, causes cleanup to quarantine its accounts. Expiry remains enforced while
cleanup is unavailable. A manager must independently check/reset and mark them clean again.

These agent tools return account references and leases, not passwords or a logged-in browser.
Login delivery remains unavailable. Other runs' reservations and accounts without current
inspect/use authorization do not appear in discovery.

## Find references from an authenticated terminal

Run `loom vault references-complete --kind account -- editor` to get active reference candidates
for a terminal picker or completion function. It prints up to 20 canonical references, one per
line, without labels or values. Put `--` before a shell-supplied query so leading dashes stay
literal. Parse errors and help use stderr for this command. Both label queries and partial
canonical references are supported. A shell completion wrapper must replace the current word
with the returned references rather than filtering them again against a label fragment. Searches
use the terminal's current Loom connection and the calling thread's inspect access under the
selected mode; they never combine environments. Use `references-search` with its continuation
cursor when you need a complete large-vault search.

`loom vault test-accounts` shows eligible dedicated accounts and your run's leases. Use
`test-account-apply` with the same JSON operation as the authenticated account tool to reserve,
renew or release one. For waiting access requests, the CLI also exposes `access-request`,
`access-request-status`, `access-request-cancel`, `access-retry-prepare` and
`access-recovery-status`. `access-request` creates a pending approval request, and
`access-request-cancel` cancels one. The other aliases report status or prepare an explicit retry;
none approve access or execute a prepared retry.

An empty readiness request checks the current run's pinned profile and credential versions when
present, otherwise the active project default when one exists. Profiles are optional; no
profile means no connection has been selected for that check. Resolve the intended resource
instead. Missing bindings, stale broker
presence and a permission-limited or changed provider run include repair guidance. Supplying
explicit requirements checks those instead. Profile configuration and broker presence do not
prove an upstream login; use a supported explicit connection check for that destination.

## Back up and recover Vault

An operator can encrypt, verify and recover an existing consistent snapshot with
`loom vault recovery`. Keep the recovery key separately from the archive and retain the
backend's unseal material. See the [offline archive procedure](../operations/vault.md#offline-encrypted-snapshot-archives).
These local commands do not capture or restore a server. Authentication does not prove that an
older backup is safe to use: restore in isolation and reconcile later revocations before
reconnecting workloads. Scheduled backups, in-app recovery and automatic promotion are not
available yet.

## Generate a password locally

Open **Settings > Loom > Vault password tools**, or choose **Generate a Vault password** in
the command palette. On mobile, open a computer's settings and find **Vault password tools**.
Generation works on the current device without a Vault backend or an active connection once
settings is accessible. Choose the length and characters, generate, and copy when ready.

Passwords start hidden and are not saved automatically. Changing the options, closing the tool
or leaving the window/app clears the result from the view. Copy uses the system clipboard;
clearing the view does not erase that clipboard or copies saved by another app.
