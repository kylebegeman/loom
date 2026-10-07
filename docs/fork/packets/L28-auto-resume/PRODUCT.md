# L28 product: automatic account failover

Selection: F7 in [selections.md](../../selections.md). Kyle retained account failover on
2026-09-27 and deferred implementation until Orchestrator V2 ships.

## Outcome

When a provider usage limit interrupts work and another eligible subscription account has
capacity, Loom can continue the thread there. Kyle can control participating accounts, see
what happened and take over. This remains useful, but is not necessary to keep working.

## Settled scope

- Retain automatic failover between eligible subscription accounts.
- Reuse upstream reset-time recovery, cancellation and persistence once released. Do not
  create a separate recovery engine to reproduce upstream behavior.
- Keep user control and an observable account-switch result.
- Do not select a metered account without an explicit opt-in. Retaining the feature does
  not authorize spending or changing real account settings.
- Leave unknown-reset retries deferred rather than guess at a recovery policy now.
- Plan and implement only after reviewing released V2 behavior and final contracts. There
  is no deadline, and other greenfield work can proceed independently.

## Questions reserved for the released implementation

- Does upstream already support automatic account selection by then? If so, what gap, if
  any, remains for Loom?
- Which providers and account configurations support native continuation or a portable
  handoff, and which continuity tradeoffs should Loom allow?
- How should eligibility, capacity, account ordering and stale or missing usage data work?
- How should the switch coordinate with upstream auto-resume, pending questions, active
  work, cancellation and concurrent clients?
- Which settings and controls are still missing, and which clients can expose them through
  upstream contracts?

These questions do not need answers now. The earlier V1 plan's same-driver/continuation-group
restrictions, Claude limitation, grace period, retry counts, default switches and custom
resume UI must not be treated as approved V2 behavior.

## Acceptance direction

A later implementation must prove account eligibility, continuity, exactly one continuation,
explicit metered-account opt-in, visible outcomes and cancellation/takeover. Concrete tests,
schemas and integration points will be written after the released upstream review, before
implementation.

The other files in this folder are superseded V1 reference material. This document and the
[packet planning policy](../README.md#planning-policy-after-the-upstream-review) govern the
retained feature.
