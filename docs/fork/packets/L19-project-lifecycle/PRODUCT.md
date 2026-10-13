# L19 product

## Problem

Agent work creates large build products, package caches, simulators and temporary data.
Without ownership and a release path, inactive projects keep consuming disk space, and
starting work on another computer requires manual repository preparation.

Loom separates the durable project and conversation from the disposable checkout and its
lane. The user chooses a project and computer; Loom prepares the workspace, while safely
published inactive work can release local files without losing its identity or history.

## Daily workflow

- **New project:** choose a connected computer, then create, clone or open a folder there.
  Loom uses that computer's tools and credentials and runs configured setup before work starts.
- **Existing checkout:** select it and continue or start a conversation. Its current files
  and local changes stay on that computer.
- **Released checkout:** the project remains discoverable. Explicit file, Git, terminal or
  conversation use restores its saved revision; starting an agent waits for setup to finish.
- **Move work:** publish the source branch, choose a ready destination computer, and prepare
  the same revision there. The destination receives a linked continuation with context and
  a link to the original conversation. Original history, attachments and provider state stay
  on the source host.

Reopening uses local recovery data when available. Dependency installation and project setup
can still take time; the implementation does not promise a fixed five-second start for every
repository or machine. Repeatable setup and isolated development fixtures reduce that work.

## Storage behavior

A checkout's lane holds disposable scratch, build output and explicitly owned development
state. Optional shell integration routes supported output into the lane. Caps are generous:
40 GB by default, 100 GB for Apple projects, with a 40 GB machine reserve. Pressure notices
and agent tools support freeing or growing space. Idle full lanes can reclaim scratch or
use available capacity. A lane is shared by conversations using the same checkout.

When no active conversation uses a lane, Loom releases its owned resources and space.
Simulators created outside the lane, unrelated processes and unlabelled containers are kept.
Checkout removal is a separate, opt-in storage policy; releasing lane output does not itself
remove source files.

Published worktrees can release after settlement or retention. Complete clones created by
Loom can also release after all conversations settle or after configured inactivity. The
project and conversation records remain. Opening a user's folder does not grant deletion
ownership, and clones created before ownership receipts remain protected.

Cleanup keeps pinned or busy work, pending actions, open providers or terminals, unique local
files, unpublished revisions and linked worktrees. Primary repositories with submodules are
kept. Ignored data is protected except for the recognized `node_modules` dependency cache.
The remote must be reachable to verify publication. Interrupted deletion retains recovery
files and blocks another release until those files are inspected.

## Entry points

- **Settings → Loom → Storage:** lane caps, reserve, usage, shell integration and resource actions.
- **Settings → Storage:** checkout release and retention policies, with results and failure reasons.
- Project creation and conversation start: select the computer owning the workspace.
- **Move work:** prepare a destination and continue there without relocating original history.
- Agent tools: lane status/free/grow/lease actions, storage reports, handoff and host GitHub setup.

## Machine model

The Mac, a Pi, a dedicated x86 host and a Mac mini use the same connected-environment model.
Each host retains its server state, credentials and conversation history. Workspace setup
must support that host's operating system and architecture; native resource policies can
provide managed SSD locations on a Mini host. A connected host still needs working Git
access and provider readiness before it can run the project.

Git transports published code between hosts. Loom does not synchronize live files, copy
credentials, provision cloud machines or move complete provider sessions. User-selected
computer placement and linked continuation implement the agreed persistent-machine workflow
without introducing another runner or a shared development database.
