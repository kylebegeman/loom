# L75 seams

## Implemented integration

No upstream files or seam manifest entries were added. The initial import uses fork-owned
contracts, service, RPC authorization, runtime, settings, palette, MCP and CLI registries.
Web/desktop use the existing settings route; mobile mounts the import section from the
fork-owned Vault settings. The capability is `vault-migration-imports`.

Private values use the existing redacted RPC ingress. The initial import has no filesystem,
SSH, GitHub, provider configuration, scheduled-run or Library integration. Inventory uses the
existing ProcessRunner for read-only Git configuration and existing typed Vault adapter metadata;
inventory invokes no SSH, GitHub login, helper or provider session. Explicit verification is a
separate method: it uses fixed SSH Git reads or scoped GitHub API sessions, without personal
configuration or credential fallback. It adds an encrypted
OpenBao migration subtree; the reviewed namespace policy is an operator-owned prerequisite.
See [operations](../../operations/vault.md#development-import-operating-policy).

Replacement plans add no upstream seams. They reuse fork contracts, scopes, runtime, settings,
palette, CLI and MCP registries. The capability is `vault-migration-inventory`; the separate
OpenBao subtree and host policy are in [operations](../../operations/vault.md#replacement-plan-operating-policy).

Verification adds only fork-owned contract, service/transport, scope, client and safe MCP/CLI
changes. SSH repository verification uses the existing transport with an isolated working
directory; ordinary workload execution behavior is preserved. There are no upstream seam
entries, new backend paths or extra deployment permissions in this slice.

Read-route previews reuse those fork-owned boundaries and the existing replacement ledger.
There is no new storage path, policy permission or upstream seam. Capability
`vault-migration-previews` gates both clients; their migration views share one state instance
per surface so receipt invalidation reaches the displayed preview.

Typed imports add no upstream seam. `ForkLayer` supplies the existing local SSH crypto adapter
to `VaultMigration`; fork-owned schemas, RPC/scope/client/MCP/CLI registries and settings handle
the new protocol. Existing item and migration subtrees are reused, with no policy extension.

## Remaining integration review

Verified cutover must inspect GitHubHostSetup and SSH configuration writers.
Prefer explicit per-repository configuration, with reviewed fingerprints and guarded rollback.
No global rewrite of personal SSH or Git defaults is selected by this first implementation.
Enumerate any future upstream edits with markers in this packet, FORK.md and the seam manifest.

Reviewed against fork main `f7cd2e14d1`; no new upstream integration needs a seam exemption.
