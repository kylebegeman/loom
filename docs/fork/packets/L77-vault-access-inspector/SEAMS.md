# L77 seams

No new upstream seams were needed. Server services, contracts, shared client state, RPC, MCP,
CLI, web/desktop settings, palette and mobile UI use fork-owned files and existing registries.
Mobile mounts access management through its existing fork-owned VaultSettingsSection.

`ext-vault` now includes shared policy, explanation and readiness contracts. See
[EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault). Packet clients
consume these shared services rather than another packet's UI internals. Broker/runner launch
and SSH integration remain future work; no new provider or SSH seam is claimed here.

The isolated fixture-home validation fix was committed separately. It is tracked under
`fork: ext-dev-fixtures` in FORK.md and the seam manifest, independent of these features.

The committed milestone merge-tree preview against local nightly
`v0.1.1-nightly.20261017.3238` passed with no conflicts. No fetch or post-merge full rehearsal
was run from this feature worktree.
