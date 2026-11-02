# L11 architecture

## Ownership follows the checkout

`DevEnvironmentService` resolves the conversation's current workspace through the existing
projection and project stores, then canonicalizes the path. Active runs are keyed by that
checkout and a discovered command. Thread IDs retain attribution and terminal ownership;
they do not isolate two conversations using the same files. Mutations serialize before
creating terminals, and request receipts reuse their recorded run or reject changed input.

The terminal shell remains the parent of the launched command. Replacing it with `exec`
can make a Node command and its child look like same-name shell helpers to the native
subprocess inspector, breaking port attribution. The shell exits with the child's status.
A real subprocess regression covers both ownership and exit status.

Port subscriptions are scoped to live runs. Output tails and retained history are bounded;
subscriptions batch updates rather than forwarding every byte. Normal terminal closure,
process exit and server shutdown release the run's scanner scope.

## One Browser capture

Browser owns both headless and desktop-backed page capture. It registers a read adapter with
`DevDiagnosticsService` while the Browser service is alive. This optional integration avoids
a core-runtime dependency on the Browser host, a fabricated agent session, or another debugger.
Reading diagnostics validates the conversation's checkout and addresses an explicit tab.
Copies are bounded and network URLs omit credentials and queries.

## Container boundary

Compose has a stable project name derived from the canonical checkout. Normalized Compose
configuration must keep resource names within that namespace and cannot reference external
resources or explicit container names. Managed database containers and volumes must carry
this checkout's ownership label before any mutation.

Database data lives in named Docker volumes. Passwords live in the existing server secret
store and enter container creation through the process environment. Inspection and normalized
Compose configuration can contain credentials, so their output is never copied to operation
logs. Connection URLs have their own terminal-protected RPC and are not returned by agent
inspection. Preserved data requires its original credential when recreating a container.

RPC and MCP handlers decode and call these services. Client mutations use permission-aware
commands; the server checks destination scopes. Existing environment forwarding routes tools
to the execution computer. No Library dependency is introduced for local development.

## Request receipts and payloads

`DevRequestsService` writes a pending receipt before contacting the target. A matching request
ID returns its saved exchange; conflicting inputs, a missing response or a cleared payload
cannot trigger another send. The network operation runs outside the history-write lock.
Clearing while a request is running leaves its later response out of saved history.

History is private, atomically written JSON under the execution computer's state directory,
keyed by canonical checkout identity. It keeps 50 payloads and bounded receipt metadata.
Request and response bodies are intentional history content; authentication headers and common
credential query fields are redacted. Corrupt or unwritable history fails closed before a new
send. No Library mutation or database migration is needed.

The HTTP client disables ambient credentials, redirects and trace propagation to arbitrary
targets. Streaming stops at the preview bound. All HTTP RPCs, including history reads, use
execution permission and guarded client commands. The separate `browser-dev-tools-http`
capability avoids advertising the new UI on older computers.
