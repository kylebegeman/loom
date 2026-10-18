# L77 implementation

Status: **In progress**. Kyle authorized the complete packet. This local milestone implements
access explanations and change previews; it does not deploy a service or migrate personal credentials.

## Delivered

The local milestone exposes the execution evaluator through an authorized explanation
service. It shows policy/grant revisions, ancestry and recent safe decisions. A versioned preview
shows known descendant grants and item references before applying a change, with explicit
unknowns for external copies and unimplemented consumers. Abandoning a preview changes nothing.

Web/desktop Settings, a contextual item link and the active-thread command palette reach the
inspector. Mobile has equivalent settings and an item-context sheet. Updated policy hides old
results in the mounted management view; readiness expires after 60 seconds. CLI/MCP reuse the
same service. Calling threads can explain only themselves and need inspect access for item
metadata; full-access administrator clients may specify a thread.

## Remaining

Join profile bindings, enrolled broker leases, pending approvals, provider identity and
rotation impact when their owning packets provide authoritative contracts. Add complete audit
retention and platform member visibility. Remote relay/tunnel, Electron shell and Android
interaction checks remain separate coverage. A preview cannot inventory external copies.

Use the complete PRODUCT target and shared extension contract when extending this milestone.
Keep thin transports and one execution evaluator. Checks and integrated evidence are in
[TESTING.md](./TESTING.md). No production rollout is implied by passing local verification.
