# L75: Guided migration from personal credential stores

Status: **In progress; reviewed development imports, local inventory and replacement plans implemented; waiting on host policy.** Kyle selected the full packet. Provider verification, typed imports and configuration cutover remain unfinished.

Replace selected interactive development dependencies with dedicated Vault credentials.

V03 | Minor improvement | Complexity: Medium | Impact: High

## Delivered and remaining scope

Web/desktop and native mobile settings can prepare a ten-minute review of one manually entered
development secret or secure note. A separate confirmation stores a new record. Cancellation,
reopen/reentry, status recovery, and guarded archival of the unchanged imported item use the
same service. CLI/MCP expose safe administrator list/status, without private-value import tools.
Local browser acceptance passed with synthetic input; native, Electron shell and remote
interaction acceptance remain pending. The import flow does not access personal stores or files, configure
SSH/GitHub, verify provider access, create grants, or change repository configuration.

On-demand inventory now reads selected local Git metadata for ten registered project roots per
page, without network/authentication or personal-store access. It reports safe endpoint hints
and local helper/SSH-command presence, not account identities. Expiring replacement plans bind
that source and an explicitly selected active SSH/GitHub item/version. Human review and
cancellation are recorded; changes or outages block review. Verification remains required and
cutover is explicitly unavailable, including for reviewed plans. Native, remote and Electron
shell interaction acceptance remain pending.

Dedicated replacement provisioning, typed SSH/GitHub imports, explicit access verification,
reviewed repository cutover and guarded configuration rollback remain selected work. Prefer
fresh Vault SSH keys and dedicated GitHub App/token connections in their existing flows.
Production use waits on the namespace policy in [operations](../../operations/vault.md#development-import-operating-policy).
No Library deployment, SQL migration or new dependency is required.

## Scope

The complete selected outcome is described in [PRODUCT.md](./PRODUCT.md). Shared guarantees,
backend choices and design gates are in [Loom Vault](../LOOM-VAULT.md) and the
[proposed foundation](../LOOM-VAULT-FOUNDATION.md). This packet does not authorize deployment,
credential imports or changes to the personal vault.

## Surfaces

Web, desktop, mobile and remote management are required. CLI/MCP availability and any
OS-specific execution constraints are defined in the product and technical documents.

## Extension points used

Existing fork core, HTTP, settings, palette, CLI and MCP registrations as applicable.
`ext-vault` has an implemented encrypted-record boundary. Broker, identity and delivery portions
have partial implementations; inspect their packets before relying on their target scope.

## Dependencies and future opportunities

Uses foundation import, connector and SSH adapter interfaces when available; missing adapters leave a clear unconverted item. Unlocks migration of existing projects and additional hosts.

## Packet seams

No upstream seams were added. [SEAMS.md](./SEAMS.md) records fork registry integration.
Implementation was reviewed against fork main `f7cd2e14d1`.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
