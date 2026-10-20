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

Agents can now use the authenticated Vault SSH/Git tools described below after an administrator
configures this computer's execution broker and grants access. Adding a key alone does not route
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
ownership and access still need separate verification and workload grants. GitHub API evidence
cannot authorize Git transport changes. Closing clears private input; reopen the review to
reenter the same material. Cancel before commit, inspect an uncertain result before retrying,
or archive the unchanged imported item. Restore archived items through Vault management.
Cutover, rollback and configuration changes remain unavailable.

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
cancellation or loss of permission during a check prevent usable success. Provider access can
be revoked after a successful check, and workloads still need their own current grants.
A lost response can be refreshed or retried without repeating an accepted check. An interrupted
receipt needs a fresh, explicitly confirmed attempt. Cancel the plan to stop further credential
use; an already started read may finish. **Cutover remains unavailable even after verification.** Administrator CLI commands
`loom vault migration-inventory`, `migration-replacements`, `migration-replacement-status`
and `migration-verification-status`
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
production credentials. Workloads still need current grants, and provider access can change
after a check. GitHub API evidence cannot substitute for Git transport evidence.

With fresh successful original and replacement receipts, choose **Preview recovery snapshot
design**. It describes proposed bounded capture and recovery safeguards. Nothing is captured or
written, and no backup exists. Close the design or cancel the plan to leave it. Real capture,
cutover and rollback execution remain unavailable.

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

## Use Vault from an agent or scheduled run

Ask an active Loom agent to use `loom_vault_ssh_exec` with the key item ID and current version,
or `loom_vault_git` to list remote refs or fetch a development repository. The computer's
administrator first enrolls and configures its execution broker, keeps it online, and grants
the thread or project permission to use the selected item at the exact destination. The agent
cannot approve its own key, host trust or root grant. Full-access/default mode is required.

Loom automatically creates, signs and releases the workload for each operation. No session
file or workload-key transfer is needed. It executes on the selected Loom server. Pi, Codex
and other providers use their existing authenticated Loom tools; web, desktop and mobile
agents reach the same service. Scheduled agent runs use the same permissions. A project grant
can cover new scheduled threads; a thread grant covers only that thread. Command-only jobs
do not inherit this agent access.

For Git, supply a repository path on the key's host, such as `team/repo.git`, with action
`ls-remote` or `fetch`. Use its exact Git destination when granting access, for example
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
fingerprints and the current item version. Threads need a separate inspect grant to use it.

Set `hostKey:null` through `ssh-trust` to remove trust without replacing the user key. You can
restore a verified pin later. Archive/restore/delete use the ordinary Vault item actions.
These actions stop future authorized use; removing a public key from the remote host and
revoking external copies remain separate work.

Grant the active thread `use` access to this item and its exact returned destination. Enroll
its machine, keep its heartbeat running and open a workload session as described above. Save
that public session JSON on the runner. Create a command file containing the current key
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
invoking host. The administrator must grant the selected key for its SSH host destination,
such as `ssh://git@dev.example.test:22`, and pin that host's Ed25519 key. A repository-only Git
grant uses the hosted `loom vault git` path instead.

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
use **Vault references**. References contain no credential values and grant no access. Use
**More references** when a sparse search page has no matches but more records remain.

Open **Vault project profiles**, choose the destination computer and project, and create a
profile with named SSH, Git or GitHub requirements. Choose an SSH key for SSH/Git and, for
Git, its exact repository path. For GitHub operations, choose a dedicated connection and one
of its allowed repositories. Switching operation kinds clears the previous binding. Review with a project thread to check its current use grants;
**Host checks only** does not prove that a thread can use the key or connection. You may save an incomplete
profile for later repair. Edit to replace/unbind keys or remove requirements; clone to start
another profile without copying secret values.

Set a profile as the default for new run resolutions, or clear the default. A run keeps the
profile revision and key versions it first resolves. Later edits/default changes apply to
later runs. A changed key or connection version requires a new run. Current grants, host trust and item state
still apply. Archiving blocks further profile use and clears its default; restoring does not
select it again. Profile selection grants no access and never changes your personal SSH agent.

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

Use **Vault attachments** above the web/desktop composer or in the mobile composer. The same
control is available in the scheduled-task prompt editor. Review a profile and attach its
current version, or choose a Vault reference. The prompt contains readable links with no
credential values. Remove/replace them through the control, or delete their lines in the
prompt. Keep attachment links on their own lines; inline or quoted examples are not requirements.

A profile requires a full-access/default agent run. Every required SSH/Git binding must have
an active key, verified host trust and a matching use grant. GitHub bindings need an active connection and exact repository use
grant within its allowlist. A reference alone requires active
metadata and inspect access; it grants no credential use. Host-only review for a new scheduled
thread does not prove its grants. Grant the project deliberately when future scheduled threads
need access. Editing a profile requires reviewing and attaching its new version before a later
run can start. Existing runs retain their pinned configuration; current grants still apply.

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

## Connect a dedicated GitHub identity

Open **Settings → Loom → Vault GitHub connections** on web/desktop, or the same section under
**Settings → Computers → Manage computer** on mobile. Use a GitHub App installation for
short-lived tokens or a dedicated fine-grained token. Enter the private credential in the form,
with 1 to 32 `owner/repository` names. App setup also needs the App and installation IDs plus
its RSA PEM key; pasted escaped newlines are accepted. Loom checks the identity and API access
to every listed repository before saving it in Vault.

Review the account, allowed repositories and connection version. **Test GitHub API access**
checks the selected repository. It does not prove that GH CLI is installed or that Git HTTPS
works. Replace credentials to create a new version. Disconnect blocks future Loom use locally;
restore reconnects locally. Revoke an App installation or token at GitHub separately. Issued
credentials may remain valid until expiry even if cleanup was attempted.

Agents use `loom_vault_github` with the connection ID/version, repository and a documented
operation. An active full-access/default run and exact use grant for
`https://github.com/owner/repo` are required. Available actions read repositories, PRs, issues
and PR checks, add comments or create issues. Inspect `exitCode`; after a timeout or uncertain
write, check GitHub before retrying. Administrators can use `github-connections`, `github-info`,
`github-test` and `github-change` through the authenticated CLI. Agent execution requires a
running thread. No command accepts raw GitHub tokens from chat.

These mediated GH operations use temporary private configuration on the Loom server. They do
not log into your personal account, configure ordinary terminal gh/Git HTTPS or change SSH
remotes. GitHub Enterprise, OAuth/device onboarding and other service connectors are not
available in this milestone. Project profiles can bind a GitHub connection/repository explicitly.

## Use a named GitHub profile binding

Choose **GitHub operations** for a profile requirement, then select a dedicated connection
and an allowed repository. You can unbind or replace it later. Review checks saved configuration
and the selected thread's grants. Host checks alone do not prove a thread can use the connection;
neither review nor launch preflight tests live GitHub API health or GH CLI installation.

Attach the reviewed profile in the composer or scheduled prompt. A new run pins its connection
version and repository. Current use grants, repository allowlist and connection/profile state
still apply. Replacing credentials requires a new run; changing a profile requires reviewing its
new version before attaching it to later runs. Configuration or access failures block launch.

An agent can call `loom_vault_profile_run` with the binding name and, for example,
`operation:{"kind":"github","operation":{"action":"pr-list"}}`. The authenticated CLI
`loom vault profile-run` uses the same input and needs a running agent thread. The profile
supplies the pinned item/version/repository. This runs through isolated server-side GH and
inherits its limits and inspect-before-retry rule for uncertain writes. It does not configure
ordinary terminal gh/Git HTTPS or your personal credentials.

## Route a terminal command through Vault

In **Vault GitHub connections**, choose the repository and copy the terminal command. Run it
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
merge/ready/review, and issue list/view/create/comment/close/reopen. Use numeric PR/issue
references and explicit flags for noninteractive writes. Git supports `ls-remote`, `fetch`,
`push` and `clone`, with the selected HTTPS URL or `origin`. For clone, use the selected URL
and optionally a new directory name under the checkout. `origin` means the selected Vault
repository for this command; fetching it without refspecs updates its remote-tracking branches.
Stored remotes and the surrounding shell's account stay unchanged. Account-login commands,
interactive flags, extensions, other destinations and custom executable transport flags fail
with guidance. A repository with custom credential, HTTP, URL-rewrite or executable settings
must have those settings reviewed and removed before routed execution.

Each invocation needs a current connection version and exact repository use grant for the
active full-access/default thread. The CLI uses its authenticated MCP connection through
`LOOM_MCP_ENDPOINT`/`LOOM_MCP_AUTHORIZATION`, or the existing ACP MCP environment. Native agent
MCP callers can use `loom_vault_github_exec` directly when terminal connection variables are
not supplied by their harness. Never transfer that authorization through chat. There is no
persistent shell activation, personal-login fallback or automatic SSH remote conversion.
After a timeout, cancellation or an uncertain write outcome, inspect GitHub before retrying.

## Check GitHub execution readiness

Choose **Check GitHub readiness** in the same connection section on web/desktop or mobile.
The default checks the selected identity's API access, GH CLI repository read and Git HTTPS
ref read on the Loom server. Select a thread to check its current run and repository use grant;
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
