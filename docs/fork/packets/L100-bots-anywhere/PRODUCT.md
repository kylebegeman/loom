# L100 product

## Problem

Bots live on the computer where they were made. Kyle's reviewer exists on Dorothy and nowhere
else, so a Mini or the VPS cannot run it, and a batch of 50 reviews competes with Kyle's own
threads for Dorothy's CPU and provider sessions. The Library already knows Kyle's computers and
projects, and the Vault already keeps secrets per computer; bots use neither.

## What Kyle gets

- **Share to Library.** One action on a bot publishes it to the Library. Every enrolled computer
  with `bots-anywhere` shows it within a few minutes with a "From the Library" badge. Editing it
  on any computer saves a new Library revision; a stale edit is refused with "This bot changed on
  Mini 2. Reload to see the change." Unshare keeps a local copy on each computer.
- **Project bots across computers.** A shared project bot names the Library project, and each
  computer runs it in its own copy of that project. A computer without a copy lists the bot as
  "No copy of this project here".
- **Vault slots, not secrets.** A bot that needs a credential declares a named slot ("GitHub
  token", "Staging SSH"). Each computer binds the slot to one of its own Vault items. The Library
  sees slot names only. A run uses the target computer's binding, checked by the Vault's own
  launch guard.
- **Run on.** Run, Run on many and pipeline steps gain a target: This computer (the default), a
  named computer, or Best available. Each target shows why it is or is not ready: offline,
  remote runs not accepted, provider not signed in, no project copy, missing tools, Vault slot not
  bound, or busy with its free slot count.
- **Results come home.** A remote run appears in the requester's run list and inbox like a local
  run, with "Ran on Mini 2", its reply, verdict and usage. Kyle can open the run thread when his
  client is connected to that computer.
- **Batches on another computer.** A batch with a target feeds items to that computer at its free
  slot count, so 50 reviews run on the Mini while Dorothy only waits for results.
- **Per-computer control.** Each computer has a Remote runs setting: off by default, and when on,
  the highest runtime mode a remote run may use (`auto` by default). Remote runs show on the
  target's Bots page under "Requested by Dorothy".

## Decisions

- The Library is a mailbox, not a runner. Computers poll it, so no computer needs to reach
  another directly, and a computer behind NAT works.
- The target runs the bot from its own synced copy at the requested revision, never from
  instructions in the request. A request carries inputs only.
- A Mini is a target only when it runs a Loom server that reports to the directory. Mini
  offload jobs run commands, not agents, so they cannot host bot runs.
- Run history stays on the computers. The Library keeps requests and results only until they are
  delivered.

## Deployment

Nothing in this packet is deployed by the implementing agent. The Library side ships when Kyle
approves a Library release; computers pick up the feature with their own updates. Until then the
Bots page says "Your Library does not support shared bots yet" and everything else works.

## Not in this packet

Cross-computer pipelines that move a checkout, Library-wide run history, and running bots on
LoomOS machines without a Loom server.
