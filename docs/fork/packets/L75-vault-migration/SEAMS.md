# L75 seams

## Implemented integration

No upstream files or seam manifest entries were added. The initial import uses fork-owned
contracts, service, RPC authorization, runtime, settings, palette, MCP and CLI registries.
Web/desktop use the existing settings route; mobile mounts the import section from the
fork-owned Vault settings. The capability is `vault-migration-imports`.

Private values use the existing redacted RPC ingress. The initial import has no filesystem,
SSH, GitHub, provider configuration, scheduled-run or Library integration. It adds an encrypted
OpenBao migration subtree; the reviewed namespace policy is an operator-owned prerequisite.
See [operations](../../operations/vault.md#development-import-operating-policy).

## Remaining integration review

Inventory and verified cutover must inspect GitHubHostSetup and SSH configuration writers.
Prefer explicit per-repository configuration, with reviewed fingerprints and guarded rollback.
No global rewrite of personal SSH or Git defaults is selected by this first implementation.
Enumerate any future upstream edits with markers in this packet, FORK.md and the seam manifest.

Reviewed against fork main `f7cd2e14d1`; no new upstream integration needs a seam exemption.
