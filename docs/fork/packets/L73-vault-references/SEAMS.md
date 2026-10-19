# L73 seams

## Implemented integration

All new implementation lives in fork-owned contracts, services, client-runtime and client
components. Existing core, RPC, settings, palette, CLI and MCP extension points register it.
The common provider instruction extension is reused without additional upstream changes.
No upstream file, SQL migration, production dependency or seam-manifest row is added.

The shared boundary is documented in [EXTENSION-POINTS.md](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault).
Other packets consume shared references/profiles, never this packet's UI internals.

## Remaining integration

Composer attachments, launch selectors and portable requirements still require explicit
integration design. They must not put credential values into turn events or bypass current
environment authority. Full packet acceptance remains open.

## Merge verification

The committed implementation is previewed with `git merge-tree` against the newest locally
available upstream nightly before handoff. The result and tag are recorded in TESTING.md.
