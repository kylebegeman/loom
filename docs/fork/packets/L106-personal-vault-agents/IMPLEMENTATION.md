# L106 implementation plan

## Starting point

This is a proposed packet, not a selected delivery date. Read [the umbrella](../LOOM-PERSONAL-VAULT.md), current registries and the cited source before changing code. No live personal import, service deployment or credential access is authorized by this design.

## Ordered steps

1. Enumerate one fixture adapter's account, origin, allowed operations, parameters and result fields. Write down how an unrestricted host agent could obtain, replay or widen access. Choose independent device custody for the synthetic proof unless OS isolation is demonstrable. Keep general session lending disabled.
2. Inspect the proposed personal extension's actual existence and version. Reuse verified authority/executor/receipt primitives where present; otherwise implement a minimal reviewed primitive through shared extension ownership or show unsupported. Do not import another packet's internal service or assume its implementation order.
3. Add packet-owned request/receipt/error schemas and permission-map entries. Test canonical origin handling, identity derivation, bounded payloads and digest binding before wiring transport. Keep personal authentication values out of all transport schemas.
4. Build the trusted executor's state machine and signed review path with fixture accounts. Add durable reservation, nonce consumption, authority recheck and cancel/revoke arbitration. Simulate a server rewriting stored requests and returning old state.
5. Add the metadata service and common MCP tools. All providers and scheduled agent runs call it; unsupported harnesses return unavailable. Command-only schedules remain rejected. Add receipt lookup for uncertain effects rather than automatic retry.
6. Add web/mobile request inspectors and trusted-client approval, with account/site/task/duration/result-audience review, explicit close versus revoke and cleanup receipts. Gate feature advertisement on real executor readiness and independent custody, not only UI presence.
7. Prove restart cleanup, timeout, disconnect, host compromise and provider session invalidation with synthetic data. Enable a session adapter only after its actual powers and exposure are tested; no arbitrary-site read-only claim.
8. Run the focused commands in TESTING, inventory actual seams and document how to review/revoke access. Independent security review precedes critical personal use. Kyle's harmless local implementation authorization remains sufficient for fixture work.

## Done when

A fixture task succeeds once, the host and agents cannot recover its credentials or mint authority, altered/replayed/expired requests fail, unknown writes are reconciled, and every issued handle can be inspected, cancelled or closed with truthful cleanup status. Unsupported surfaces/adapters remain explicit. Real-site acceptance and security review evidence are separate from this synthetic milestone.
