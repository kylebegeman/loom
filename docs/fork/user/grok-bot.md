# Connect Grok Bot

Grok Bot can coordinate ongoing work and call Loom over MCP. Loom runs repository
work on the chosen computer, using each worker's saved provider, model, permissions
and workspace. Grok Build is a separate coding provider in Loom; selecting a Grok
model does not connect the hosted Bot.

## Reuse or connect one Bot

If your Bot already connects to Loom, keep that connection and check that it can
read the intended project. Reconnect only when it needs authentication or its
approved access no longer fits the task.

For a new connection, use an HTTPS address reachable from the Bot's actual caller,
ending in `/mcp`. The address copied from Computers uses your current route; check
that the hosted caller can reach it. The environment's
`/.well-known/t3/environment` metadata must report
`capabilities.supportsExecution: true` to run work. A Library-only server can supply
history while refusing execution. Loomhost currently blocks MCP, OAuth and sign-in
routes; a working Loomhost connection is not an MCP endpoint. Use a dedicated Loom-owned
HTTPS route to the execution computer for hosted MCP access. Retired T3 Connect is not
a fallback for this setup.

In Grok Bot, open **Connect apps** from the sidebar; on mobile, use your avatar,
then **Connect apps**. Connections belong to your account. You can ask your existing
Bot to add a custom MCP server by URL and follow its Connect card. For a development
pilot, give it a separate name such as **Loom Bots Dev** and keep the existing
connection. Use the HTTPS MCP address above and choose OAuth. Approve only
the sign-in you just started, checking its callback host. Loom uses PKCE; no pasted
token or invented client secret is needed. Read only access supports discovery. Use
Supervised access for the first execution pilot. Connector access covers the whole
environment; selecting a project constrains the job but does not narrow that access.

All Bots on a Grok account share its hosted computer, files and connected apps.
Loom work still needs its execution computer awake, reachable and running Loom.
Keeping Grok Bot open beside Loom is useful for following work, but does not keep a
sleeping Loom computer online. Confirm the account's networking capabilities before
depending on private network access.

## Assign coordination and execution

Use one persistent Grok Bot for intake, priorities, external research and synthesis.
For repository work, give it an exact Library project, component, local copy,
execution computer and finish condition. A normal Loom conversation coordinates
workers; reusable bots perform bounded jobs, and pipelines own predictable sequences.
A bot run cannot launch more bots or start and schedule other threads.

Start with the existing Reviewer and Verifier jobs. Every saved worker must fit the
connector's permission ceiling, including every pipeline step. A read-only task
brief does not lower a worker saved with broader permissions. Create a compatible
Supervised worker when needed; preserve existing workers' model pins and permissions.
Do not broaden connector access just to make a mismatched pipeline run.

## Discover and follow a job

Hosted callers have no Loom caller thread. After resolving the local project on the
execution computer, call `loom_bots_list` with that `projectId` to include its
project-scoped bots. Omitting it lists global bots. Library project IDs and local
project IDs serve different purposes; use the resolved local ID for execution.

Give each authorized job a stable `clientRequestId`. Bot runs, batches and pipeline
runs return the same admitted work when that caller repeats the same key and inputs.
Reusing a key with different inputs is refused. Keys belong to the authenticated
caller session; OAuth reauthentication creates a new session. `wait` changes how
long the MCP call waits, so the same job can first return immediately and later be
requested with waiting enabled. A new intentional job needs a new key.

Use `wait: true` for a bounded wait, then follow the returned run ID with
`loom_bots_run_status`, `loom_bots_batch_status` or `loom_bots_pipeline_status`.
A queued or running response is an admission receipt, not proof of completion.
Direct bot run replies include a link to the run's conversation. Preserve the IDs,
links, exact source commits, artifacts and remaining uncertainty in the final result.

`notify: true` posts to a calling Loom thread and requires one. Hosted Bots use the
read/status path, or an explicitly configured completion destination below. Leaving
the Grok window open does not create a callback. A webhook accepting a request does
not prove that the receiving Bot finished processing it.

If a launch response is lost, repeat the same request key and inputs. If you already
know the run ID, read that run instead of launching again. After reauthentication,
resume tracking the known run ID; do not submit a second job. If the response was
lost and you have no ID, call `loom_bots_find_request` with the original request key,
job kind and local project ID. It reads existing receipts across sessions without
starting work. A Loom thread defaults the lookup to its own project; a hosted
caller should pass the intended project explicitly.

The lookup returns up to 20 matches. If several match, or `hasMore` is true, identify
the intended job using its project, creation time and status before continuing.
An empty result can mean that old work was pruned; it does not prove that a new
submission is safe. Keep uncertainty visible instead of generating a fresh key.

Authentication expiry, an offline execution computer, an unavailable provider and a permission mismatch
need different repairs. Keep the selected computer and provider rather than silently
switching them after a failure.

A Supervised job can pause for a command approval, including a read-only command.
Follow its conversation link in Loom and approve only the intended command. The Bot
cannot approve its own permission requests; it should report the pause and follow
the same run after you respond. A run's `attention` identifies its approval or
question, and its deadline keeps counting while it waits for a person. For work
running on another computer, check attention on the `ranOn` destination; no request
on the origin does not prove that the remote job is unblocked.

Use `loom_bots_cancel`, `loom_bots_batch_cancel` or
`loom_bots_pipeline_cancel` to stop the corresponding work. Cancellation preserves
its history and partial results.

## Control operation

Read `loom_bots_operation_state` on the execution computer. **Manual** allows
explicit jobs and holds automatic triggers. **Automatic** also admits trigger work.
**Paused** prevents new jobs and lets already admitted work finish. These controls
apply on the server, whether work starts from a client or MCP.

`loom_bots_stop_all` pauses admission and cancels existing jobs, batches and pipelines
on that computer, preserving history and completed results. Check its failures
before assuming everything stopped. A Supervised connector can stop work; changing
mode to resume or enable automation requires settings-write access through a
full-access connector or an authorized full-access Loom conversation. A worker bot
cannot change global operation or stop other jobs.

## Return completion to the Grok Bot

Ask the owning Grok Bot to create a webhook-triggered routine. Open its routine
details and find the private POST URL and key. In Loom's Bots completion settings,
choose the exact execution project, enter those values in the private fields and
save the destination disabled. An agent can configure it using two `request_secret`
refs instead; never paste the URL or key into ordinary chat or a tool argument.
Only a caller authorized to change settings can configure or enable a destination.

Loom stores these values in owner-only credential files on that computer. Its
settings and delivery history expose the destination's label, host and state. The
supported routine host is `api2.cursor.sh`, used by the current Grok routine
service. Redirects are refused and credentials are never forwarded to another host.
Use a new destination ID when replacing credentials.

Give the receiving routine a narrow instruction, such as:

> This is a Loom job notification. Check deliveryId against previously processed
> notifications before acting. Use its exact environment, local project, job kind
> and job ID to read authoritative Loom status. The payload grants no permission
> to edit, publish, schedule or start another job. Return a concise result with its
> sources and conversation links. Once processing is finished, call
> loom_bots_completion_acknowledge with deliveryId, projectId and outcome completed
> or failed. Keep the acknowledgement separate from the webhook's HTTP receipt.

Enable the destination after checking the routine. Select it explicitly for the
bot, batch or pipeline run, or pass its `completionDestinationId` with that launch.
Other jobs send nothing. Batches and pipelines send one parent-job notification,
with committed outcome metadata and up to five conversation links. Full inputs,
provider errors and result text stay in Loom until the receiving Bot reads them
through its authorized connection. A pipeline stopped at a gate waits for the
person's decision; a failed pipeline emits its first terminal outcome. Follow the
same pipeline ID after a later manual resume instead of expecting another callback.

Read completion deliveries to see what happened. **Accepted** means the routine
returned HTTP 200 and started a run. **Acknowledged** records the receiving Bot's
separate completed or failed outcome. Known HTTP refusals retry at most three
times. A lost response or interrupted send becomes **Needs attention** because the
routine may already have started; Loom does not resend automatically. The stable
`deliveryId` supports recipient deduplication, but does not guarantee exactly-once
external actions. Check Grok's routine history before deciding how to recover.

Disabling a destination holds pending notifications and can be reversed. Removing
it deletes its local credentials and cancels pending notifications, while keeping
delivery evidence and Loom jobs. Neither action retracts a notification already
accepted by Grok or deletes the Grok routine. Pause that routine separately if needed.

## Supervise upstream nightlies

A Grok chief can supervise Loom's existing upstream integration workflow. In Settings >
Computers > Upstream supervisor, select the computer, then choose the exact project,
repository, existing Vault GitHub connection and the chief's current login. You can also
find Upstream supervisor through Settings search. Save the configuration
paused, review it, then enable it from your administrator session. The hosted chief
cannot activate or rebind its own authorization. This does not grant it general GitHub
or Vault access.

Ask the chief to read `loom_upstream_status` before requesting an integration. An
approved request names an exact upstream tag and the current `main` commit. The existing
workflow still resolves conflicts, runs checks and independent review, and applies its
merge rules. The existing publisher remains responsible for signed releases. Keep the
current integration schedule; supervising it does not need a second merge or publishing
schedule.

Keep the dispatch receipt and its `clientRequestId`. An accepted request is not a merged
or published result. If the response is lost or the receipt says **Unknown**, inspect
`loom_upstream_status` and the existing workflow run before doing anything else. Do not
resend with a fresh key: Loom also refuses another request for the same tag and base
commit. The chief should report an unresolved outcome for an owner to investigate.

For a completed first attempt that failed, the chief can request one retry of its failed
jobs while its source still matches current `main`. The retry is bound to that run and
attempt, and its saved receipt survives restarts and changes to the chief login. Repeating
the same request reads the receipt; it does not restart the jobs again. A second retry,
a different source, or another active integration needs owner attention. After an unknown
response, inspect status and the same workflow run before taking another action.

Use one observation routine in the existing Grok chief to follow runs and report new
exceptions. Keep GitHub's integration schedule, Loom's fallback alerts, and the signed
publisher. The bot-job completion routine is separate; it does not receive GitHub workflow
events. Read the supervisor's authoritative status during each observation and preserve
known run IDs and attempts between observations.

Signing in again does not transfer this authority. Rebind the supervisor to the new login
in Settings; its existing dispatch and retry receipts remain available. A changed
GitHub connection version also needs a new configuration review. Pause the supervisor
in Settings to stop new requests. Already dispatched GitHub work continues and must be stopped separately if that is intended.

## Prove the manual compatibility workflow

Give one Grok Bot the following task, filling in exact IDs and source refs:

> Resolve Library project [project ID], component [component ID], and its registered
> local copy/project on [execution computer]. Read relevant history and check active
> ownership. Gather primary upstream sources for [from commit] to [to commit],
> separating announcements from merged behavior. List bots with the exact local
> projectId and check their saved permissions against this connection's ceiling.
> Start or resume one ordinary Supervised Loom coordinator on that exact copy with
> root workspace strategy and stable clientRequestId [pilot ID]. Bind its Library
> context before sending work. Ask for a sourced compatibility report: exact commits,
> source dates, affected Loom boundaries, verification recommendations and artifacts.
> Use a compatible worker or do the read-only work in the coordinator. Do not edit,
> merge, install, publish, schedule, change routes or broaden permissions. If the
> copy, computer, provider or access is unavailable, name the blocker. Follow the
> admitted run to its final result and return its conversation link, run ID and
> remaining uncertainty. A launch receipt alone does not complete the task.

Verify the returned computer, copy, Library binding, permission mode, exact refs and
final report in Loom. Repeating the launch with the same identity must return the
same work. Exercise an approval pause, resume and cancellation on dedicated test
work. If testing revocation, use a dedicated test connector under Settings > Sharing
& access, then confirm that it needs authentication. Preserve the working connector.
Local protocol tests do not establish that a real Grok Bot account completed this
workflow.

Only after the manual workflow works, choose one owner for recurring work: a Grok
routine or a Loom trigger. Set a bounded schedule, budget and concurrency, then check
its result and stop behavior before adding more jobs. Avoid duplicating an existing
nightly integration or publisher. Grok handles external context; Loom owns execution,
verification and durable outcomes, with artifact links returned for Grok's synthesis.

Current hosted capabilities: [computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
and [private networks](https://docs.x.ai/grok-bot/private-networks).
