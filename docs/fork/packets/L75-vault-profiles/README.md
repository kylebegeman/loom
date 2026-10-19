# L75: Project environment profiles

Status: Selected for implementation by Kyle on 2026-10-17. In progress; reference/profile management milestone implemented locally. Full packet scope retained.

Bind a complete set of development accounts, credentials and endpoints to a named project environment.

V04 | Minor improvement | Complexity: Medium | Impact: High

## Scope

The complete selected outcome is described in [PRODUCT.md](./PRODUCT.md). Shared guarantees,
backend choices and design gates are in [Loom Vault](../LOOM-VAULT.md) and the
[proposed foundation](../LOOM-VAULT-FOUNDATION.md). This packet does not authorize deployment,
credential imports or changes to the personal vault.

## Delivered milestone

Web/desktop and native mobile manage project-local SSH/Git profiles: create, edit, clone,
preview, choose/clear a default, archive, restore and repair bindings. MCP/CLI resolve and
execute named bindings. The first resolution durably pins the profile revision and key
versions for the authenticated run; current grants, keys and archive state remain authoritative.

Task/composer launch selectors, portable requirement declarations, other credential kinds,
account provisioning, Library sharing and run-pin retention automation remain selected.
No production rollout or personal-vault migration occurred.

## Surfaces

Web, desktop, mobile and remote management are required. CLI/MCP availability and any
OS-specific execution constraints are defined in the product and technical documents.

## Extension points used

Existing fork core, HTTP, settings, palette, CLI and MCP registrations as applicable.
`ext-vault` has an implemented encrypted-record boundary. Broader identity and delivery portions remain in progress; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Uses reference and grant interfaces; connectors supply validation when installed. Unlocks reproducible task templates, previews and onboarding. Degrades to missing requirements when optional account provisioning is absent.

## Packet seams

No new upstream seams. The implementation uses existing fork registries and the shared
`ext-vault` boundary. [SEAMS.md](./SEAMS.md) records scope and merge verification.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
