# L77: Credential health and maintenance inbox

Status: **In progress** on fork main, with matched-history and recovery follow-up. Kyle selected the full packet; the maintenance inbox and bounded validation are implemented and verified locally; production rollout remains pending.

Collect expiration and authentication maintenance into one actionable inbox.

V05 | Minor improvement | Complexity: Medium | Impact: High

## Delivered and remaining scope

Encrypted per-environment expiry rules and deduplicated issues now cover declared expiry,
GitHub validation and safe GH/mediated SSH/Git operation outcomes. Web/desktop and mobile have
inbox/rule management, snooze/unsnooze, dismiss/reopen, recheck and access-review entry points.
Administrator CLI/MCP use the same services. Reads never initiate provider login.

Current project profile bindings and project/thread grant references are available on demand,
ten projects per page, with review links. Each scanned project can inspect retained selections
in pages of 25, including projects with no current references. Earlier item/profile versions
remain visible; retired selections with removed snapshots are counted as unattributable.
Each response reports its page scope and unresolved discovery limits. Grants pointing to missing projects or threads are counted across the environment and can be reviewed even on an empty page. External consumers are not discovered, provider-side copies remain unknown, and current authorization is not evaluated. Older servers show an explicit coverage-unreported notice. These references do not prove usable access. Validation now covers explicitly configured GitHub repositories and opt-in fixed SSH connection
checks. Matched retained history, review/retirement and failed-read recovery have web acceptance. Linked profile history hides stale cards and retirement controls until a successful refresh. Other connector kinds and native interaction acceptance remain incomplete.
This is not a full packet completion or a production rollout. See TESTING for exact evidence.

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
remain target designs; inspect the exact specification before consuming them.

## Dependencies and future opportunities

Uses item metadata, usage events and optional validation adapters. Can work with manual expiry before automated rotation exists. Unlocks maintenance planning and renewal automation.

## Packet seams

No new upstream seams were added. [SEAMS.md](./SEAMS.md) records fork-owned integration
and the required host policy change. Reviewed against fork main `cc05b69aed`.

## Documents

- [PRODUCT.md](./PRODUCT.md)
- [TECHNICAL.md](./TECHNICAL.md)
- [SEAMS.md](./SEAMS.md)
- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [TESTING.md](./TESTING.md)
- [REFERENCES.md](./REFERENCES.md)
