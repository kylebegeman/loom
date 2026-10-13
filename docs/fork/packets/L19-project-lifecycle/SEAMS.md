# L19 merge constraints

The lane and resource services use existing fork registries. Checkout lifecycle also relies
on narrow upstream integrations, so this packet can conflict during an upstream merge.

## Boundaries to preserve

- Successful cloning records primary-checkout ownership; opening an existing folder does not.
- Project and repository identity remain available after release. Passive status and identity
  queries do not restore directories.
- Explicit Git, file, terminal, new-thread and provider-start paths restore managed roots.
  Restored setup must finish before provider execution and remain retryable after failure.
- Storage cleanup verifies fresh publication and protects busy work, local files, pins,
  pending actions, nested projects, linked worktrees and retained recovery folders.
- Setup and settlement script terminals accept an internal held lease; clients cannot supply
  that bypass through RPC.
- Settings decoding supplies disabled defaults for older hosts, and client controls respect
  the advertised capability.

[docs/fork/seams.tsv](../../seams.tsv) is the executable marker manifest. It covers actual
`project-lifecycle` markers in the recovery helpers and focused integration tests, alongside
`mini-native-retention` and `mini-managed-projects` markers. Keep it aligned with source.
The source and tests record individual integrations; this page records the behavior a merge
must preserve rather than duplicating their file catalog.

## Merge check

Run the seam check and the affected lifecycle tests and consumer typechecks described in
[TESTING.md](./TESTING.md). A full maintenance check is a separate integration gate; a docs
or marker-manifest correction does not require running every fork suite.
