# L78: Explain access and preview changes

Status: **In progress**. Local access explanations and change previews milestone implemented; full packet scope retained.

Explain effective credential access and the impact of changing it.

V06 | Minor improvement | Complexity: Medium | Impact: High

## Delivered milestone

The local milestone exposes the execution evaluator through an authorized explanation
service. It shows policy/grant revisions, ancestry and recent safe decisions. A versioned preview
shows known descendant grants and item references before applying a change, with explicit
unknowns for external copies and unimplemented consumers. Abandoning a preview changes nothing.

Web/desktop Settings, a contextual item link and the active-thread command palette reach the
inspector. Mobile has equivalent settings and an item-context sheet. Updated policy hides old
results in the mounted management view; readiness expires after 60 seconds. CLI/MCP reuse the
same service. Calling threads can explain only themselves and need inspect access for item
metadata; full-access administrator clients may specify a thread.

## Remaining selected scope

Matching project profiles, current provider/run identity, live item workload sessions,
administrator broker presence and retained thread/item approvals are joined through bounded
read-only sources. Restricted agents see only their own requester metadata and no broker labels.
Context has a deadline and expires; partial/unavailable/drifted joins cannot change a decision.
Rotation impact, complete audit retention and platform member visibility remain. Remote relay/tunnel, Electron shell and Android
interaction checks remain separate coverage. A preview cannot inventory external copies.

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
`ext-vault` has an implemented encrypted-record boundary. Broker, platform identity and delivery portions
remain target designs; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Uses the shared evaluator, metadata and minimum audit interfaces. Approval and rotation features add relationships when present. Unlocks access reviews and more reliable support diagnostics.

## Packet seams

All implementation lives in fork-owned code and existing registries. No new upstream seams
were required for this chunk. See [SEAMS.md](./SEAMS.md) for the shared boundary.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
