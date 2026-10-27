# L19 merge constraints

The lane and resource services use existing fork registries. Checkout lifecycle also relies
on narrow upstream integrations, so this packet can conflict during an upstream merge.

## Boundaries to preserve

- Successful cloning and confirmed, current review of an existing primary Git root record
  ownership. Opening a folder and enabling cleanup never grant it. Review and mutation stay
  on the owning host; fingerprint revalidation runs under its workspace lease.
- Primary-folder Keep, release-on-settle and inherited defaults do not alter worktree policy.
  Keep explicitly restores a released folder; passive reads never do. Version 1 receipt
  compatibility remains; older runtimes cannot read newly written version 2 receipts.
- Project and repository identity remain available after release. Passive status and identity
  queries do not restore directories.
- Explicit Git, file, terminal, new-thread and provider-start paths restore managed roots.
  Restored setup must finish before provider execution and remain retryable after failure.
- Storage cleanup verifies fresh publication and protects busy work, local files, pins,
  pending actions, nested projects, linked worktrees and retained recovery folders.
- Setup and settlement script terminals accept an internal held lease; clients cannot supply
  that bypass through RPC.
- Settings decoding supplies disabled defaults for older hosts, and client controls respect
  the advertised capability. The landed-worktree rule is the exception: it decodes on, and the
  Storage toggle appears only when every connected host advertises `landed-worktree-cleanup`.
- The landed rule never contacts a remote; it trusts the last fetched remote default ref. It
  deletes a branch only by compare-and-delete, never the default branch, and only when the
  checkpoint `restoreWorktree` would use has the deleted head as its parent.
- Releasing a managed checkout or Library copy refuses while a linked worktree made from it
  exists outside it. Locked or unreadable entries count; only prunable ones are skipped.
- Lane shells move TMPDIR, so the CLI and desktop place the desktop control socket with
  `systemTempDir` (`packages/shared/src/fork/system-temp-dir.ts`). Otherwise `t3 app` run
  in a lane misses a desktop started outside it, and the lane path overflows the socket limit.

[docs/fork/seams.tsv](../../seams.tsv) is the executable marker manifest. It covers actual
`project-lifecycle` markers in the recovery helpers and focused integration tests, alongside
`mini-native-retention` and `mini-managed-projects` markers. Keep it aligned with source.
The source and tests record individual integrations; this page records the behavior a merge
must preserve rather than duplicating their file catalog.

## Merge check

Run the seam check and the affected lifecycle tests and consumer typechecks described in
[TESTING.md](./TESTING.md). A full maintenance check is a separate integration gate; a docs
or marker-manifest correction does not require running every fork suite.
