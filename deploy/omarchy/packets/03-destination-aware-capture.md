# 3. Destination-aware capture

Capture once, choose Office or Atlas and review before saving.

Status: **completed**. Complexity: **Medium**. Impact: **High**.

Owner: Office and Atlas with LoomOS adapters. Dependencies: [#12](12-shared-app-integration-contract.md).

## Scope

- Preview clipboard/selected text and supplied links with a supported destination picker.
- Office retains reviewed Note, Reminder and Desk flows; Atlas exposes a reviewed source capture flow.
- Retain capture through login; provide loading, error, cancellation and duplicate-submission handling.

## Acceptance

- Use literal text, Unicode, links and supported length limits across both destinations.
- Cancel without writing or fetching a supplied URL.
- Verify signed-out return, server failures and supported offline behavior.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Clipboard and primary-selection preview, a native destination picker and Iris app-owned review are implemented for Office Note, Reminder, unsent Desk draft and private Atlas Research source. Supplied links stay literal and are never fetched.
- Exact retained attempts preserve edits, account, idempotency key and replay deadline through sign-in/reload. Meaningful transport, queue, failure and account checks pass; packaged Office offline shell/save/reload/exact local Note/reconnect/replay proof passes.
- Workstation native packaged fixtures pass all four destinations, exact opening, cold launch, original-window reuse and no-write Discard. Atlas also passes the 390px review; affected native pack checks pass 78 tests.
- Office source 506035c passed protected exact-source preparation: 1,033 UI tests, 402 strict PostgreSQL/restore tests, 33 browser journeys with one documented optional skip, production image and TLS smoke. Reviewed backup op-20261012-181510-xbmnx and deploy op-20261012-181611-bqfxb passed; live revision 20261012-181611/interface feecdad173068284f0b0 verifies all 91 assets and unchanged native feed. Update Office delivered it into the original signed-in window with an activated worker and no waiting update.
- Atlas source c2f99a5 passed 516 UI tests and required server/script checks. Compact runtime19 is installed after verified original-key pre-release recovery; fresh encrypted retrieved restore proof 7a500e018abef52fc0dc431aea8c42e7a99a2d3475cdb68a74f7293ae570207e commissioned its healthy service/timer. The installed Atlas Update control delivered interface f01ff7f1c7df20388da8 into its original signed-in window.
- Immutable LoomOS pack 20261012.24 is installed, SHA256 a09f39d4e215c5272d4f543f278acb5bfad0f7f8f42f211630ccc8791410d0af. All 26 members match committed source 260a54bba5; pack23 remains verified for rollback. Config SHA256 9dce07b11f516fee66c28f5f1c91022bb424a74c55ef40b823ec914cac17c6ef, Iris/pixel branding and t3code.service PID1152 are preserved.
- The actual installed picker displays all four destinations. Both installed app reviews can be discarded while preserving their original windows; no personal fixture records or provider inference were used. Source and owning release records are pushed or retained in verified full-history bundles. Evidence: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/capture/. No new durable Atlas offline queue, Mac unified-update proof or real-provider acceptance is claimed.
