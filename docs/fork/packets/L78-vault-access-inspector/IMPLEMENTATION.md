# L78 implementation

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

The inspector now observes matching project profiles, the current provider/run, current item
workload sessions and enrolled-broker presence, and retained requests for the selected thread/item.
These bounded, read-only observations expire within 60 seconds and carry explicit omitted counts.
Inspect access bounds related metadata; async context/version drift withdraws relationship labels.
Partial or unavailable context never changes the separate evaluator decision. Profiles are labelled
as project defaults, not inferred current-run selections. No credential delivery or new storage is added.

Remaining: versioned rotation impact across those consumers, complete audit retention and platform
member visibility. Remote relay/tunnel, Electron shell and Android
interaction checks remain separate coverage. A preview cannot inventory external copies.

Use the complete PRODUCT target and shared extension contract when extending this milestone.
Keep thin transports and one execution evaluator. Checks and integrated evidence are in
[TESTING.md](./TESTING.md). No production rollout is implied by passing local verification.
