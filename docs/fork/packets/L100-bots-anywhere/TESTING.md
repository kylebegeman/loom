# L100 testing

Focused `it.effect` tests. Two computers are two service layers with separate fork SQLite
databases and environment ids; the Library is a third layer with `LOOM_LIBRARY_AUTHORITY` on,
reusing `apps/server/src/fork/project-library/Library.testkit.ts` where it fits. Long-polls and
leases use `TestClock` and `Deferred`, never sleeps. No test reaches a real Library, VPS, Mini or
Vault backend.

## Library service and routes

- Publish creates revision 1; a save with a stale `expectedRevision` fails `revision-conflict`;
  `list` after a cursor returns only newer definitions and deletions.
- Routes refuse non-publisher sessions, `mcp-client`, and a body naming another environment;
  oversized bodies get 413 before reading.
- Submit refuses an offline target (status older than 2 minutes), one not accepting, and one that
  reported the bot not ready.
- `requests/next` returns immediately when a request waits, wakes on a submit during the wait,
  and redelivers after the 2-minute lease without an ack. An unleased request older than 10
  minutes becomes a refusal for the requester.

## Sharing and sync

- Sharing a project bot maps its project to the Library project through a ready working copy;
  a project without a copy is refused.
- The second computer pulls the bot as a linked local definition in its own copy of the project,
  or unrunnable with a reason when it has none. L98 (when present) records the version.
- A linked save while the Library is unreachable is refused; unshare clears links on both sides.
- `modelOverride` survives a pull and is never published.

## Vault slots

- Bound slots appear as standalone Vault links in the run's first message; unbound slots make
  the target not ready. The links name the target's environment, never the requester's.
- A preflight block (stub guard) ends the run failed with the guard's message on the requester.

## Remote runs

- **Round trip.** Requester writes a queued remote row; target dedupes, starts, posts `started`
  and `terminal`; requester's `awaitRun` returns the reply, verdict and usage with `ranOn`.
- **Instructions stay on the target.** A request whose revision is newer than the target's
  copy triggers a sync; a revision that does not exist is refused.
- **Ceiling.** A `full-access` bot is refused by a target whose ceiling is `auto`.
- **Cancel.** Cancel on the requester interrupts the target's run and both rows end cancelled.
- **Restart, requester.** L89 recovery leaves remote rows alone; results that arrived while down
  are applied after restart; past the deadline the row is `timed_out` with the target's label.
- **Restart, target.** A request leased but not acked is redelivered and starts exactly once
  (`remote_request_id` unique).
- **Batch.** A 50-item batch with a target feeds at most the target's free slots at once and
  takes no local permits.
- **Inbox.** Failed remote runs show in the requester's inbox and not the target's.

## Compatibility

Decoding a `BotDefinition` with `library` and a `BotRun` with `ranOn` or `requestedBy` through
the previous schema succeeds. With the Library feature absent, existing bots tests pass
unchanged.

## Manual

On request only, after Kyle approves a rollout: one remote run from Dorothy to a Mini running a
Loom server, through the real Library.
