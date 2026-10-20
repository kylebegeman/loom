# Use another computer in Loom

A Mac, a full LoomOS machine or a Mini board running Loom is a normal
environment. Connect it once, choose it when starting a thread, and use the
usual composer with its installed providers.
Projects and files live on that computer. The command-job snapshot limit does
not apply to native agent threads.

Select the **Computers** icon beside Settings, Pull Requests and Usage in the
main sidebar, or **Open computers**
from the command palette. The list includes all Loom environments: Macs, Linux
machines running full LoomOS, Mini boards and other hosts. Choose **Connect
computer** and paste the other computer's pairing link.
Run `t3 pair` on that computer to get a fresh link. For SSH connections or
additional routes, use **Settings → Connections → Add environment**. A Mini
server bound to loopback needs an SSH tunnel or another configured route to reach
it; pairing does not change its network binding.

Choose **Start thread** on a connected computer. Select a project when it has
several; with none, Loom uses its normal scratch workspace when available.
Provider setup and status belong to that computer. Use **Set up agents** or
**Check agents** if it has no ready provider. Provider accounts stay configured
through normal Loom settings. **Route through Switchboard** is under that
computer's **Settings → Providers**, and its hub and controller addresses come
from the `LOOM_SWITCHBOARD_URL` and `LOOM_SWITCHBOARD_CONTROLLER_URL` environment
of the server running there.

## Optional command jobs

Open **Command jobs** from a thread’s panel picker or **Open command jobs** from
the command palette. Use **Run command** for builds, tests and scripts that
should run on an SSH worker while you continue in the current thread. Enter the command and
choose a destination. Resource limits and an optional name are under **Resource
limits and task name**. The default reserves 6 GiB RAM and four CPU cores, with a
60 minute deadline. SDKs, credentials and dependencies must already be available
on the worker or installed by your command.

An administrator can add a destination under **Worker connections** or
**Settings → Loom → Command workers**. SSH keys and verified
host keys must already work on the Loom server. Enter a name and its SSH host alias, then use the connection check to see capacity and missing project tools. An administrator can start an already installed queue worker from the setup result. Mini's SSD storage and job queue
must be enabled on the worker. Disabling a worker prevents new submissions;
existing jobs remain inspectable, cancellable and recoverable.

If the same worker moved or its SSH setup changed, choose **Change connection**
on its row and enter the new host alias. Its earlier jobs use the new connection
too. Add a different computer as a new worker instead. **Remove** stops new
commands to a worker; its earlier jobs stay listed and keep the connection saved
with them. When the connection check says SSH refused the worker's host key,
the worker was probably reinstalled or replaced: confirm its new key, update
`known_hosts` on the Loom server, then check again.

The snapshot contains the committed revision only, up to 1 GiB before
compression. Loom sends it compressed, which needs LoomOS 0.1.13 or later on the
worker. Commit local changes first, or explicitly choose the committed revision
with local edits.
Ignored files,
Git history, submodule contents and external Git LFS objects are not included.
Tracked files follow Git archive/export attributes. This runs trusted commands
with the worker account's access.

Select a job to read its state and the last 1 MiB of logs. Active results refresh
while the panel is open. Cancel queued or running work from the result view.
Finished jobs can return a checksum-verified Git patch, including nonignored new
files, up to 64 MiB. Download and review it, then run `git apply --check` against
the submitted revision before applying it.

To save build outputs, expand **Files to collect** before submitting and list exact
repository-relative file paths, one per line. Up to 32 files and 60 MiB total can
be retained, including ignored build files. Directories, links and `.git` are
excluded. Finished jobs, including failed jobs, offer **Download outputs**. The tar
bundle contains the files and a checksum manifest with any missing files listed.
Outputs survive automatic workspace cleanup and follow the worker's result
retention policy. Existing jobs without declarations return patches only.

If a transfer fails, the worker may already have accepted the job. Use **Recover
transfer**. Loom saves the request identity and snapshot before sending
and reuses them for recovery, including after a server restart. Recovery returns
the same job; it does not dispatch to another node. The panel blocks new work
while a transfer from this thread remains uncertain. A disconnected Loom server
does not cancel accepted work.

Agents can use `loom_mini_workers`, `loom_mini_submit`, `loom_mini_recover`,
`loom_mini_list`, `loom_mini_inspect`, `loom_mini_cancel`, `loom_mini_patch` and
`loom_mini_artifacts` and the read-only `loom_mini_worker_check`. Agents declare `outputs` when submitting; collection returns
a verified file manifest and missing-file list. Binary content is omitted by
default; `includeBundle: true` explicitly returns the tar as base64.
Their jobs belong to the calling thread. Submit and recover require a live
full-access thread in default mode. Agents cannot register new workers. With
full access, `loom_mini_worker_update` changes a moved worker's connection and
`loom_mini_worker_remove` removes a worker.
Registering, changing and removing command workers requires environment
maintenance access; submit, recover and cancel require terminal access. Reads
require orchestration read access.

Computers and Command jobs are available in web and desktop Loom. Native mobile
lists its environment connections under **Settings → Computers**, but has no
Command jobs panel or command-worker controls in this release. Automatic worker selection and moving an
existing conversation between computers remain separate features; starting a
new conversation on a native environment uses the ordinary Loom flow.
