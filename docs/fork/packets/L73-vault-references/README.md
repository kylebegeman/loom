# L73: Searchable credential references everywhere

Status: Selected for implementation by Kyle on 2026-10-17. In progress; reference/profile management and explicit launch attachments implemented locally. Full packet scope retained.

Attach named Vault items without copying their values into prompts or settings.

V02 | Minor improvement | Complexity: Medium | Impact: High

## Scope

The complete selected outcome is described in [PRODUCT.md](./PRODUCT.md). Shared guarantees,
backend choices and design gates are in [Loom Vault](../LOOM-VAULT.md) and the
[proposed foundation](../LOOM-VAULT-FOUNDATION.md). This packet does not authorize deployment,
credential imports or changes to the personal vault.

## Delivered milestone

Environment-scoped search and stable reference copying work in web/desktop Settings, native
mobile computer settings, palette navigation, MCP and CLI. The project profile editor reuses
the picker to bind, replace and unbind SSH keys. Agent search/describe requires inspect grants;
forbidden and unknown IDs both describe as null. No credential values are returned.

Composer and scheduled-prompt attachments now use safe standalone links. CLI completion,
role/account search, cross-environment discovery and other consumers remain selected.

## Surfaces

Web, desktop, mobile and remote management are required. CLI/MCP availability and any
OS-specific execution constraints are defined in the product and technical documents.

## Extension points used

Existing fork core, HTTP, settings, palette, CLI and MCP registrations as applicable.
`ext-vault` has an implemented encrypted-record boundary. Broader identity and delivery portions remain in progress; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Uses metadata search, reference resolution and access summaries from the shared foundation. Unlocks profiles, task templates and plugin consumers without requiring their implementation.

## Packet seams

Management uses existing fork registries. Launch integration adds marked provider guard and
web/native control seams, recorded in FORK.md and seams.tsv. [SEAMS.md](./SEAMS.md) records scope and merge verification.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
