# L11 product

The development workflow is to start the checkout, see whether it is ready, open it, inspect
failures and stop the exact run. Loom coordinates the project actions, environment settings,
terminals, Browser and development dependencies so that Kyle can do this through the UI or
an agent, including from a phone.

## Runs and ownership

Runs belong to a canonical checkout directory on an execution computer. A second conversation
in that checkout sees and reuses the same active command. A second worktree gets independent
runs. The original conversation and terminal remain visible; stopping another conversation's
run requires an explicit UI confirmation or an authorized agent request.

Start uses existing project actions, the mapped dev command or discovered package scripts.
The existing project-profile service prepares environment loading. Readiness follows process
ownership and detected listeners. Commands without listeners remain visibly running; failures
retain their exit code and bounded output. Stop and restart target the recorded terminal,
never a process found by name.

Runs end when their terminals close or the server shuts down. Start/control retries reuse
request IDs and reject changed inputs. Their history is bounded and local to the running
server; it is not a durable job scheduler.

## Browser evidence

Browser diagnostics reads the existing capture for an explicit tab in the conversation.
It supports console/network views, error filtering, refresh and draft insertion. Reading does
not navigate, take a screenshot, attach another debugger or take control. Clear view affects
this view, preserving the underlying capture. URLs omit embedded credentials and queries.

Opening a run uses existing Browser and preview links. Public sharing configuration is an
independent capability; this feature does not create domains or alter fleet networking.

## Development dependencies

Compose operations use a stable checkout-specific project name. External resources, explicit
container names and global resource names are refused to keep operations within that checkout.
Stopping a stack preserves its volumes. Health and recent logs remain inspectable.

Postgres and Redis-compatible Valkey bind to loopback ports on the execution computer. Each
checkout gets named, ownership-labeled containers and data volumes, plus a credential in the
server secret store. Removing a container preserves its data and credential by default.
Recreation reuses them; it refuses a preserved volume whose credential is unavailable.
Explicit delete-data removes only the owned volume. Databases remain in Docker until stopped
or removed, including across Loom restarts.

The UI copies connection URLs only on request and explains which computer can use them.
Agent inspection omits credentials. Docker unavailable states leave ordinary dev servers usable.

## Entry points and surfaces

Development is available from the panel picker, command palette and Browser's start view.
The web and desktop clients share the panel. The native phone app uses conversation tools
and preview links. Every operation runs on the computer owning the selected conversation's
checkout, including over remote connections. Unsupported servers hide the feature.

The HTTP request lab remains planned after these slices. Full API clients and database
browsers remain separate products.
