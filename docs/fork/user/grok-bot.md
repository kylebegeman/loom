# Connect Grok Bot

Grok Bot is a hosted app that can call Loom over MCP. Grok Build is Loom's existing
coding provider. Selecting a Grok model does not connect the hosted Bot.

## Connect one Bot

Use an HTTPS MCP address reachable from the Bot's actual caller, ending in `/mcp`.
The address copied from Computers uses your current route; verify that a hosted
caller can reach it. Check the environment's `/.well-known/t3/environment` metadata:
launching requires `capabilities.supportsExecution` to be true. A Library-only server
can supply history while refusing agent execution. Loom Reach currently blocks `/mcp`, the MCP OAuth routes and
the sign-in page. A working Reach connection is not an MCP endpoint. Use an existing
public HTTPS environment route, such as T3 Connect when configured, or a private
HTTPS route whose reachability from the Bot computer has been independently proved.

In Grok Bot, ask to add a custom MCP server with that URL. Choose OAuth and approve
only the sign-in you just started. Loom discovers its authorization server and uses
PKCE; you do not need to paste a token or invent a client secret. Start with Read only
to list projects. For the launch pilot, reconnect with Supervised access and confirm
the approval names the Bot's actual callback host. This access covers every project
on that environment; the pilot's project pin is a task constraint, not an access grant.

Grok Bot's custom MCP supports URL or command connections. Its hosted computer is
shared by every Bot on your account. Desktop egress routing does not grant general
private-network access, and the documented Team Setup networking path is Enterprise
only. Confirm your account capabilities before depending on either.

## Run the compatibility pilot

After authentication, give one Bot this task, replacing the brackets with exact IDs
and upstream refs. Keep this first run manual:

> List Loom's Library projects and resolve [project ID], [component ID] and an exact
> registered copy/local project ID on [computer]. Read relevant recent history and
> check active ownership. Gather the upstream release announcements and source range
> [from] to [to] into a sourced compatibility brief, separating announcements from
> merged behavior. Start one supervised Loom conversation on that exact local project
> with the root workspace strategy and stable clientRequestId [pilot ID]. Bind Library
> context before sending work. Ask only for a read-only compatibility report with
> source dates, exact commits, affected Loom seams and verification recommendations.
> Do not edit, merge, install, publish, schedule, dispatch more agents or change routes.
> If the copy, permissions, provider or network is unavailable, report the blocker.
> Read the conversation's result and return its link, run ID, source citations and
> remaining uncertainty. A launch receipt is not a completed report.

Verify the returned project/computer, Library binding, permission mode, exact refs and
final result in Loom. Retrying after a lost response must reuse the pilot ID. A busy
thread may accept a queued message; follow the returned run rather than resending it.
If the Bot cannot launch at its approved ceiling, repair its connector approval rather
than switching credentials or requesting Full access by default.

Then revoke that Bot's client under Settings > Sharing & access. Ask the same Bot to
list projects again: it must need authentication. Revoking Loom access is separate
from disconnecting an app in Grok Bot. Keep the report link and sanitized connection,
launch, result and revocation evidence. Local protocol checks do not establish that a
real Grok Bot account completed this pilot.

Current supported setup: [Grok Bot computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
and [private networks](https://docs.x.ai/grok-bot/private-networks).
