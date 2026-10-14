# Context in portable handoffs

T3 Code transfers conversation context when you switch providers, continue through a portable
restart, or use a fork that the provider cannot resume itself.

Short conversations transfer intact. For longer conversations, T3 Code favors recent requests and
answers, the original request, and relevant activity such as command outcomes. Selected messages
keep their full text, order, and user or assistant role, including partial work from failed or
interrupted turns. Your new request stays separate and is never shortened to make history fit.

Codex receives historical messages directly when its installed version supports that operation.
Other providers receive the same selection as attributed conversation context. A handoff does not
copy the outgoing provider's reasoning, tool-call state, or attachments.

The handoff includes references to omitted history. The agent can use T3 Code's thread-reading tool
to retrieve saved messages and activity, including the remainder of a long item. For an important
constraint, you can still repeat it in your next message. A handoff is a budgeted selection, not an
agent-written summary.

## Context limits

A handoff must leave room for existing provider context, your request and attachments, instructions,
tools, and subsequent work. If even its retrieval references cannot fit, T3 Code reports an error
instead of shortening your request. Compact the target conversation or select a larger-context
model before trying again.

Server operators can set `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP` to change the initial history allowance
(default 16,000; clamped to 1,024–64,000). This is an upper bound, not a provider context-window
guarantee. Text accounting conservatively charges one token per UTF-8 byte, including attribution
and JSON escaping. Imported history has a separate 64,000-byte ceiling; your current input and
attachment payloads do not consume that ceiling.

T3 Code uses available capacity information for your selected model and options, together with
provider context telemetry. Starting a fresh provider conversation clears prior usage, while keeping
known model capacity. Changing models or context-window options discards stale usage and compaction
thresholds.

When no capacity information is available, T3 Code assumes a 128,000-token window. It reserves at
least 16,000 tokens, or a quarter of the window when larger, for instructions, tools, and subsequent
work. Images reserve an estimated 8,192 tokens each, independent of their file size; other
attachments reserve 4,096 each for their references. Existing context is estimated from saved
activity when usage telemetry is unavailable. Known smaller windows still constrain the handoff.
These are fallback estimates, not exact token counts. Image resolution, custom models, and hidden
native context can differ, so the provider may still reject an input.

## Continue on another machine

In Loom, use **Move work** from a thread's menu or the command palette.
Choose the destination computer and a project for the same repository. If it has no matching
project yet, use **Prepare project** from Move work, or **Prepare on another computer** in
Project home, to review the source origin and destination folder and create its working copy.
You do not need to add the project separately. Preparing a copy does not move the conversation.

Connect both computers before continuing. Both hosts need workspace operation permission;
preparing a new copy also needs project creation and source-control write access on the
destination. The destination needs Git access and a working provider. Stop the source thread
and its background work, commit local changes, and publish the branch before starting.

Loom prepares a separate destination workspace at the published commit and waits for workspace
setup to succeed. It checks the destination provider, model, and runtime before settling the source,
including when retrying a saved preparation. It then starts a linked conversation with the original
request and recent conversation context. The original conversation, attachments, provider session, and checkpoints
stay on the source host. The destination uses that host's project model and runtime settings.

If preparation fails, the source remains available. Retry the saved handoff to reuse completed
steps and avoid sending the continuation twice. Starting over keeps any prepared destination
thread; review it before beginning another attempt. After completion, reopening the handoff returns
to the existing continuation. You can start a new handoff if the original thread remains active or
you resume work there.

After preparation, Loom settles the source only if it has remained unchanged and has no local
application data or ignored files other than dependency folders. Otherwise, it keeps the source
active and explains what was retained. Source checkout cleanup follows that host's Storage
settings. Databases, local configuration, credentials, and other application data are not moved;
use reproducible development fixtures or a separate backup and restore workflow when needed.
