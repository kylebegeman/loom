# L02 product

## Problem

A long agent conversation often reaches a point where Kyle wants to try something else
without losing what he has: a second approach from the same starting point, a different
model on the same problem, or a quick question about the project that should not bloat the
main thread's context. Today that means a new thread that knows nothing, or copying text by
hand. Once there are several related threads, nothing shows how they relate or lets him keep
an eye on two of them at once.

## What the user can do

- **Fork from any message.** Hover a message, click "Fork from here", and get a new thread
  that starts with the conversation up to that message. On a user message the fork carries
  everything before it and puts that message's text into the fork dialog for editing, so
  "fork and try a different ask" is one step.
- **Choose where the fork runs.** A fork gets a new worktree from the source's branch by
  default, so two approaches never edit the same files. "Same workspace" keeps the source's
  workspace (sharing its uncommitted files), and "Project root" uses the project root. Pick
  another provider or model, for example fork a Claude thread into Codex.
- **Choose how much context the fork gets.** "Conversation" (default for forks) gives the
  model the earlier conversation; "None" starts clean; "Native session" (phase 2, Claude and
  Codex) continues the provider's own session from that point, which keeps tool results and
  reasoning the transcript cannot carry.
- **See related threads.** The Related threads panel lists the parent, children (forks,
  sidecars, agent-started threads), siblings, and threads that implemented a plan from this
  thread, each with status (working, needs approval, done, error), branch and age.
- **Message a related thread without leaving.** Select one in the panel and use the compact
  composer under it to send a message; its reply streams into the panel.
- **Start a sidecar.** "New sidecar" opens a side thread in the same workspace, next to the
  main thread in the right panel. It starts with a clean context by default, or with the
  main thread's conversation when the user asks something about it.
- **View two threads side by side.** Open any other thread of the project in the right
  panel, read it, steer it, stop it, or open it full size.
- **Undo a relationship.** Unlink removes a thread from the lineage without deleting it.
  Deleting a thread (upstream) also removes its links.

## Entry points

| Action                | Where                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fork from a message   | Hover action on user messages (next to "Edit from here" and Copy) and on assistant messages (next to Copy).                                      |
| Fork the thread       | Command palette "Fork thread" (forks from the latest settled message); keybinding command `loom.thread-lineage.fork` (unbound).                  |
| New sidecar           | Related threads panel button; palette "New sidecar"; keybinding command `loom.thread-lineage.sidecar` (unbound).                                 |
| Related threads panel | Right panel launcher and "+" menu ("Related threads", letter R); palette "Show related threads"; keybinding `loom.thread-lineage.related`.       |
| Side by side          | "Open side by side" on any row of the Related threads panel; right panel launcher "Side by side" (letter H) opens a thread picker; palette item. |
| Leave                 | Close the panel tab; "Open full view" in a thread pane navigates to that thread; Unlink in the row menu; delete the thread as usual.             |

Settings: none in v1. The fork dialog remembers the last context choice per kind per
browser (`loom:thread-lineage:fork-defaults:v1`). The workspace always starts at the kind's
default (fork: "New worktree"; sidecar: "Same workspace"), so a fork is isolated unless the
user picks otherwise each time.

## Copy

- Message action tooltip: "Fork from here".
- Dialog title: "Fork thread" / "New sidecar".
- Context options: "Conversation" ("The new thread's first message includes the earlier
  conversation."), "None" ("Start clean."), "Native session" ("Continue the provider's own
  session from this point." Shown only when available.)
- Workspace options: "New worktree" (default for forks; hint "Starts from the source
  branch's last commit, without its uncommitted changes."), "Same workspace" (default for
  sidecars; hint "Shares files with the source thread."), "Project root". When the project
  is not a git repository, "New worktree" is disabled with "This project is not a git
  repository." and the fork defaults to "Same workspace".
- Trimmed notice: in the dialog before forking, "Earlier messages trimmed: the oldest N
  messages are left out of the model's context."; in the child thread, the first message's
  context chip reads "Forked conversation (earlier messages trimmed)"; after the fork, a
  toast "Earlier messages trimmed. N older messages were not sent to the model."
- First message placeholder: "What should the new thread do?" (required when context is
  "Conversation": the conversation travels with the first message).
- Related panel empty state: "No related threads. Fork from any message or start a sidecar
  to create one."
- Missing parent: "Forked from a deleted thread."
- Thread pane approval notice: "Waiting for approval. Open the thread to respond."
- Upstream server: the message button and panels are hidden; a stale panel tab shows
  "Related threads need a Loom server."

## States

- Loading: panel rows show a skeleton while `listForThread` loads; thread panes show
  upstream's thread loading state while the detail subscription connects.
- Empty: the empty-state copy above.
- In progress: the fork dialog's Fork button shows "Forking..." and is disabled; errors stay
  in the dialog. After success the app navigates to the new thread (fork) or opens it in the
  right panel (sidecar).
- Error: typed server errors map to copy ("The message is no longer in this thread",
  "Could not create the worktree: ...", "Native fork is not available for this thread; use
  Conversation instead").
- Disabled: fork is disabled for draft threads and while the thread's environment is
  disconnected. Native mode is disabled while the source is running.
- Trimmed: when the transcript exceeds the fixed budget (about 90,000 characters), the
  oldest messages are dropped first. The dialog warns before forking, and the fork shows
  the "earlier messages trimmed" notice (chip and toast above). The trimmed messages are
  still visible in the child's imported history; only the model's transcript leaves them
  out.

## Surfaces and connection modes

Web and desktop are required and identical. Mobile is not supported: fork children and
sidecars appear there as ordinary threads with their imported history. Remote, Tailscale
and T3 Connect work, since everything goes through the environment's WebSocket. Upstream T3
servers hide every entry point. An upstream client talking to a Loom server sees forks as
ordinary threads.

## Decisions

- No merge step. Two threads can be compared side by side; combining work stays manual.
- Replay first, native second. Replay works across providers (fork Claude into Codex) and
  needs no adapter change; native forks keep more context but need per-provider code and a
  spike.
- The transcript travels as a composer context record on the child's first message, so the
  user sees exactly what the model received (a "Forked conversation" chip) and upstream's
  own context delivery path sends it. That is why replay needs a first message.
- Imported history is visible in the child but, by upstream design, never sent to the model
  on its own (`thread.history.import` only writes the read model).
- Sidecars are ordinary threads with a lineage row of kind `sidecar`, so they work on every
  client and survive without Loom.
- Links live in a fork table, not in thread metadata, so upstream T3 can still read the
  database after a rollback.
- Forks default to "New worktree", with "Same workspace" (and "Project root") offered in the
  dialog: isolation is the safe default for trying a second approach, and sharing files is
  one click away. Sidecars default to "Same workspace" because they discuss the same work.
  A project that is not a git repository falls back to "Same workspace".
- The transcript budget is fixed at about 90,000 characters, oldest messages dropped first,
  and not configurable: it keeps the first message under upstream's provider input limit,
  and a setting would only let users break that. When trimming happens the fork says so
  ("earlier messages trimmed") in the dialog, in the child's context chip and in a toast.
