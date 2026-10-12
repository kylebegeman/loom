# 12. Shared app integration contract

Apps describe their supported OS capabilities instead of making LoomOS guess their internals.

Status: **verification_pending**. Complexity: **Large**. Impact: **High**.

Owner: Office and Atlas with LoomOS adapters. Dependencies: None.

## Scope

- Extend existing app-owned registries/contracts for actions, stable links, search, capture, notifications and availability.
- Keep authorization, validation and business operations inside each owning app.
- Provide version negotiation, unavailable-capability behavior and reusable adapters without a second product runtime.

## Acceptance

- Verify compatible, older, missing and malformed capability declarations.
- Typecheck and behavior-test affected producers and consumers across supported surfaces.
- Integrate at least Office and Atlas through the same contract without weakening their permissions.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Office and Atlas expose protocol 1.0 through anonymous no-store build metadata and their existing authenticated operation registries. Metadata grants no account, record, scope or approval authority.
- LoomOS negotiates search/capture formats, actual registry CLI words and Unicode limits; current Atlas uses workspace search. Only missing declarations retain legacy controls. Incompatible, malformed, redirected or inaccessible declarations provide recovery guidance.
- Both real producers and installed loopback consumer dispatch passed interoperability proof. Compatible/additive/missing/malformed versions, unavailable capabilities, anonymous HTTP routing, permission refusal, literal arguments, Unicode bounds, result normalization and cancellation are covered.
- Office make check passed (1008 web tests, Go checks, 65 scripted cases and docs); Atlas make check passed (493 web tests and Go checks). 121 pack tests passed on Mac, 83 focused consumer/action/release tests on native ARM Linux, with targeted formatting and lint.
- Immutable pack 20261011.17, SHA256 69097b48b360ac3e4042048cf6508b371d206ae5f995257f4182d301646bc7c9, prepared. Actual retained .14 upgrade/rollback/return passed on Mac and native ARM Linux, preserving custom shortcuts, configuration and synthetic app/credential data.
- Workstation SSH timed out; installation and physical acceptance remain pending. Office/Atlas service publication follows their existing release workflows. Exact-item handoff, unified notifications and live availability remain explicitly unavailable; no durable Atlas offline support is claimed.
- Verification artifacts and rollout handoff: /Users/kyle/Developer/artifacts/loom-os/2026-10-11/app-integration. Shared Iris has no changes. Packet #14 remains excluded.
