# 11. Contextual actions and AI workbench

Operate on deliberately selected context and review results before handing them to an app.

Status: **completed**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#3](03-destination-aware-capture.md), [#12](12-shared-app-integration-contract.md).

## Scope

- Support selected text, files, screenshots and app-provided context with explicit preview.
- Reuse supported Loom/app actions and Switchboard routing; show owning environment and failure/retry states.
- Allow reviewed copying, capture and app actions with retained provenance and original permissions.

## Acceptance

- Check context selection, cancellation, size/type failures and routing eligibility.
- No action silently captures unrelated app data or falls back to a direct provider.
- Verify complete explanation, summary and capture workflows with synthetic inference before authorized live acceptance.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Implemented explicit selection, clipboard, UTF-8 file, saved PNG/JPEG screenshot and version 1 app-exported JSON context through the native workbench, LoomOS menu, Loom actions and CLI. Preview freezes the chosen input for retries; cancellation, error/recovery, edited results, copying and reviewed Office/Atlas capture retain source provenance. Opening reads no unrelated window or record.
- Explanation and summary reuse visible T3 scratch threads and the verified Switchboard route. Native credentials use separate HTTP/MCP audiences in Secret Service, scoped to orchestration read/operate with expiry and explicit revocation. Provider plan and approval controls remain authoritative; prompts prohibit tools but the existing runtime does not enforce an answer-only sandbox. No direct-provider fallback is introduced.
- All 262 integration-pack tests pass on Mac and native x64 Linux, covering context limits, malformed files/images, required image preview, changed clipboard, routing refusal, retry/cancellation, capture limits, permissions and retained provenance. The Mac pack gate, scoped lint/format and generated-view checks pass. Five failing-before-fix transport cases prove bounded session cleanup on success, denial, cancellation, initialization-body cancellation and cleanup failure. Native full-gate formatting was not claimed because the extracted source lacks the workspace formatter setup.
- Authorized native text explanation and selected-image summary completed through Switchboard in separate fresh threads. The image request uploaded exactly one explicitly selected 592-byte synthetic PNG and correctly described purple/yellow panels. Both recorded zero tool calls, subagents or runtime approval requests and left zero active jobs. In-flight cancellation uses focused synthetic coverage; interrupting the completed exact run was an idempotent no-op.
- Inspected native preview/result screens and actual Office summary and Atlas source reviews. The Office review contained the generated summary, original image hash and Loom thread identity; Atlas contained deliberately selected source text and its hash. Neither review saved personal fixture records, and original app windows were retained. Real namespaced T3 IDs and the installed capture-watcher subprocess defect were corrected with regressions.
- Workstation runs immutable pack 20261012.43, manifest SHA256 c00943b7494a1192efc1fd6479e94b3f6de33de18a9b2b582f4f316d7e6f53c1. All 35 members verify and match installed bytes. Actual .43 to .42 rollback and .43 reapplication passed; no activation is pending. Native compatibility and connection health report zero errors and warnings.
- Independently built Mac and Workstation recovery kits match recipe SHA256 2eb0d8f90d8c77d19d295336271c6b939728b5de72c44485602cb27d69272f69. Supported commissioning reports all 16 checks ready and preserves all 40 recorded file/mode checks, Iris Dark, gradient branding, credentials, personal bindings and DND off. The existing Loom, Office, Switchboard and server inventories are reused; the reviewed Atlas client is pinned. Pack rollback and recovery refresh preserve running T3 PID 319427 and earlier kits.
- App-provided context has a supported explicit file contract; automatic Office/Atlas export controls remain a future app feature. Selected text is the current everyday integration. Text/results are bounded to 64 KiB, images to 4 MiB and 20 million pixels, and optional instructions to 2,000 bytes. Evidence: /Users/kyle/Developer/artifacts/loom-os/2026-10-12/workbench-desk/. Packet #14 remains excluded.
