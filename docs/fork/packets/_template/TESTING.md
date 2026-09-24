# Lxx testing

How the packet is proven. Follow AGENTS.md: focused tests, no repo-wide checks, no sleeps.

## Automated tests

Each test file and the behavior or failure mode it covers. Server behavior needs focused
tests; registries need invariant tests (unique ids, prefixes, no upstream collisions).

## Commands

The exact `vp test run <files>`, `vp lint <files>` and `vp run --filter <package> typecheck`
commands for this packet.

## Manual check

What Kyle (or an agent with permission) checks in a real client, on which surfaces, with
which data. Include the upstream-server case: the feature is hidden or explains itself.

## Merge safety

Result of the merge preview against the newest nightly, and of
`scripts/fork/loom.sh integrate nightly --dry-run` once merged to main.
