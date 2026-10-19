# L84: Credential delivery API, CLI, and runner integrations

Status: In progress. Signed workload checks and automatic operation-scoped SSH/Git access through authenticated provider launches implemented; complete delivery scope retained.

Give agents, developer tools and automation one consistent way to consume Vault access.

V13 | Major system | Complexity: Large | Impact: Transformational

## Delivered boundary

An authenticated active Loom thread can open, list and close a five-minute session bound to its
current run, provider instance, project, enrolled host, item and exact destination. The host and
workload each prove a separate Ed25519 identity through single-use HTTP challenges. CLI checks
revalidate current use grants, host presence and thread permissions. They return safe metadata
with credential delivery explicitly unsupported. No secret material, SSH signature or provider
login is returned. Control-plane restart invalidates sessions.

See [user help](../../user/vault.md#check-an-authenticated-workload-channel) and
[TESTING.md](./TESTING.md). Existing provider launches also attach authenticated tools that
create, sign and release a workload automatically for SSH commands or Git ref listing/fetch.
The operator must configure an enrolled broker for the server first. No workload key/session
file transfer is required for these operations. Git uses the current thread checkout and an
exact repository grant. See [use from an agent](../../user/vault.md#use-vault-from-an-agent-or-scheduled-run).
Ordinary terminal SSH agent routing, general shell exec, SDK delivery modes and
per-workload OS isolation remain pending.

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
`ext-vault` has an implemented encrypted-record boundary. Host enrollment and workload channel checks are implemented. Actual delivery portions
remain target designs; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Implements ext-vault delivery adapters and workload launch integration. Uses storage, broker and grants interfaces without requiring every connector. Unlocks external developer tooling, CI and plugins.

## Packet seams

The shared boundary registers through existing fork-owned service/HTTP/MCP/CLI registries.
A small shared-provider instruction seam adds Vault guidance; no dependency is added. See [SEAMS.md](./SEAMS.md).

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
