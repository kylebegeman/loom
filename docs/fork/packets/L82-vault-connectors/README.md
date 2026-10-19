# L82: Developer service accounts and authentication connectors

Status: **In progress**. Selected by Kyle on 2026-10-17. Dedicated GitHub management and
mediated headless GH operations are implemented locally. Full packet scope retained.

Manage GitHub and other developer service identities as tested, renewable connections.

V11 | Major system | Complexity: Large | Impact: High

## Delivered milestone

Web/desktop and native mobile manage github.com App installations and dedicated tokens with
repository allowlists, identity/API validation, credential replacement, local disconnect and
restore. Vault encrypts the private material through OpenBao. Agents use bounded GH operations
on the Loom server with current run/version/grant checks and temporary CLI configuration.
App tokens are limited to the selected repository for use and released on scope exit where
GitHub permits it. A failed release can leave the token valid until expiry.

Explicit scoped commands are available below; this does not configure persistent shell login, upstream GitHub auth precedence or
SSH remotes. Project profiles now bind connections/repositories, pin their versions and
execute named GitHub operations through the same service. Version 2 declarations share requirements
without local bindings. OAuth/device onboarding, Enterprise hosts, additional
connectors and managed provider revocation remain selected. No personal credential migration,
live account registration, push, PR or deployment is authorized by this milestone.

## Surfaces and integration

Web/desktop and native mobile management, remote environment RPC and authenticated MCP/CLI
reuse existing fork-owned registries. `vault-github` gates clients on older servers. A running
agent needs full-access/default mode and exact repository use permission; administrator
management is a separate right. Shared constraints are in [Loom Vault](../LOOM-VAULT.md),
the [foundation](../LOOM-VAULT-FOUNDATION.md) and [extension points](../EXTENSION-POINTS.md).

## Dependencies and future opportunities

Uses existing encrypted records, access grants and provider instruction channels. No new
production dependency, upstream seam or SQL migration. The GitHub adapter can inform later
registry, deployment and infrastructure connectors without requiring them for this milestone.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)

The [GitHub terminal/readiness milestone](../L82-vault-connectors/TECHNICAL.md#github-terminal-routing-and-readiness)
adds explicit scoped gh/Git HTTPS execution and cancellable API/tool checks. Full packet scope
remains In progress; see [user guidance](../../user/vault.md#route-a-terminal-command-through-vault).
