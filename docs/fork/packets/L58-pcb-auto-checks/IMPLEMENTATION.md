# L58 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commits use
`feat(fork-pcb-auto-checks): ...`. The panel refresh fix in step 7 is its own
`fix(fork-pcb-auto-checks): refresh open panels when an agent runs a check`.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md and this
folder. Check what landed first:

- L52: if `kicadReports.ts` exports `findingId` and keeps item `uuid`, reuse them and skip that
  part of step 1 and 2.
- L68: if `projectSettings.ts` and the `projectSettings` RPC pair exist, add `autoChecks` to
  them instead of creating them.

For manual checks use a KiCad 10 project with a board, on a host where you can save from KiCad
or with a script that edits the `.kicad_pcb` file.

## Steps

1. **Contracts.** In `packages/contracts/src/fork/pcb-preview.ts` add `PcbCheckTrigger`,
   `PcbResolvedFinding`, `PcbCheckDelta`, the three optional `PcbCheckResult` fields,
   `PcbAutoChecks`, `PcbProjectSettings` and its inputs, `PcbCheckEventsInput`,
   `PcbCheckActivity`, `ensureFresh` on `PcbLatestChecksInput`, and the three methods in
   `PCB_PREVIEW_WS_METHODS` and the RPC group. Add `uuid` and `id` (TECHNICAL.md, "Finding
   identity") only if L52 is absent. Add `checkEvents` to `ForkSubscriptionRpcTag`,
   `updateProjectSettings` to `FORK_CLIENT_GUARDED_RPC_SCOPES`, and the three scope rows to
   `apps/server/src/fork/rpcAuthorization.ts`. Run the contracts typecheck. The server
   typecheck fails until step 5 adds the handlers; do steps 2 to 5 before committing if you
   prefer one green commit.
2. **Delta.** In `kicadReports.ts` add `checkDelta` (and `findingId` plus uuid parsing if L52 is
   absent). Tests in `kicadReports.test.ts`.
3. **Settings store.** Create `projectSettings.ts` with `get`, `update` and a change PubSub,
   and `projectSettings.test.ts`.
4. **Scheduler.** Create `autoChecks.ts` with the state, constants and flow from TECHNICAL.md.
   Take `runCheck`, `readStored(key, kind)`, `snapshot(resolved)` and the settings store as
   dependencies, so `autoChecks.test.ts` can drive it with fakes and `TestClock`.
5. **Service.** In `PcbPreviewService.ts`:
   - Split `check` into `runCheck(resolved, kind, trigger, timeout)` and the public wrapper
     through `scheduler.manual`.
   - Compute the delta and `durationMs`, skip writes for failed automatic runs, publish on
     `checkBus`.
   - In `watch`, register interest with `scheduler.watching` in the stream's scope and tap
     emissions into `scheduler.notify`.
   - Add `ensureFresh` to `latestChecks`, plus `projectSettings`, `updateProjectSettings` and
     `checkEvents`. Add interface entries (`:85-160`) and exports (`:2568-2606`), and handlers
     in `rpc.ts` (`auth.effect` for the pair, `auth.stream` for `checkEvents`).
   - Extend `PcbPreviewService.test.ts` (TESTING.md).
6. **Agent tools.** In `mcp.ts`, update the two descriptions, add `ensureFresh` with the MCP
   default true, and add `loom_pcb_check_settings`. Update `mcp.test.ts`.
7. **Client runtime and refresh.** Add the settings query, the command and the `checkEvents`
   subscription to `packages/client-runtime/src/fork/pcb-preview.ts`. In `usePcbPreview.ts`
   subscribe for the selected KiCad design and refresh `latestChecks` when `ranAt` advances.
   This alone fixes agent-run checks not showing up in an open panel; commit it as the fix.
8. **Status bar.** Update the check chips in `PcbPreviewPanel.tsx` (`:1356-1379`) and
   `checkBadge` (`:665-674`) for checking, delta and paused text, tone and title.
9. **Checks.** In `ChecksView.tsx` add the "Check after each save" row, delta summary, "New"
   badges, the resolved disclosure and paused notices. If L52 landed, pass the added ids to
   `CheckMarkers` for the extra ring.
10. **Docs.** Add a short paragraph to the Checks section of `docs/fork/user/pcb-preview.md`:
    what the setting does, that it is per project, that it runs only while the design is open or
    an agent reads checks, and the pause rules. Put the reason checks run on the server and the
    caps in a code comment at the top of `autoChecks.ts`, not an internal doc.

## Done when

- With the setting on for DRC, saving a board change while the panel is open runs DRC about two
  seconds later, once, and the chip shows the new and resolved counts.
- Saving three times in a second runs DRC once; saving during a run interrupts it and the next
  run uses the latest files.
- Pressing "Run DRC" during an automatic run replaces it, and no automatic run starts while the
  manual one is running.
- Closing the panel stops pending and running automatic checks.
- A run over 60 s pauses automatic DRC with the PRODUCT.md notice; a fast manual run resumes it.
- An agent saving a fix and calling `loom_pcb_latest_checks` gets results for the saved files
  with the finding marked resolved.
- An agent's `loom_pcb_check` refreshes the open panel.
- Off by default; turning it off stops scheduling for the project.
- Every TESTING.md command passes.
