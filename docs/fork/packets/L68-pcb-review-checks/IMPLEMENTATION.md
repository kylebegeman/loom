# L68 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling. Commits use
`feat(fork-pcb-review-checks): ...`.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md and this
folder. Check what landed first:

- L58: if `projectSettings.ts`, the settings RPC pair and `loom_pcb_check_settings` exist, add
  the `review` key to them. Otherwise create them exactly as L58's TECHNICAL.md specifies, with
  only the `review` key, so L58 can add `autoChecks` later without reshaping anything.
- L52: if `PcbFinding`, `findings.ts` and `CheckMarkers.tsx` exist, feed review findings into
  them. Otherwise skip markers; "Locate" still works through the existing focus path.

You need KiCad 10 to generate the real netlist fixture in step 1. Unit tests do not need it.

## Steps

1. **Fixtures first.** Create `apps/server/src/fork/pcb-preview/fixtures/review/` with the
   hand-written netlists and circuit JSON files listed in TESTING.md, and one real netlist:
   `kicad-cli sch export netlist --format kicadsexpr` on KiCad's bundled
   `demos/complex_hierarchy` (KiCad 10.0.x), saved as `complex_hierarchy.net`. Record the
   command and version in `fixtures/README.md`. Confirm from it whether `#PWR` nodes appear in
   nets and adjust step 3 if the TECHNICAL.md assumption is wrong.
2. **Contracts.** Add the review schemas, methods, scopes and the `review` settings key
   (TECHNICAL.md, "Contracts"). Add both methods to `FORK_RPC_REQUIRED_SCOPES` and `review` to
   `FORK_CLIENT_GUARDED_RPC_SCOPES`. Run the contracts typecheck.
3. **Model.** Create `reviewModel.ts` with the types, both builders, `classify`, `parseValue`,
   `netRole`, `netVolts` and `throughSeries`. Create `reviewData.ts` with the patterns and the
   regulator table. Write `reviewModel.test.ts` against the fixtures.
4. **Verify the regulator table.** For each entry, open the manufacturer datasheet, confirm or
   correct `vinMaxV`, `dropoutV`, fixed outputs and `minOutputCapUf`, set `sourceUrl` and
   `checkedOn`. Leave `checkedOn: null` for any entry you cannot confirm; it then only
   recognizes the part.
5. **Rules.** Create `reviewRules.ts` with `REVIEW_RULES`, the eight matchers and `runReview`.
   Write `reviewRules.test.ts`: one passing and one failing fixture per rule, plus ids, caps,
   `limited` and parameter fallback.
6. **Service.** In `PcbPreviewService.ts` add the no-connect collector to `sourceInspection`,
   return the netlist text from `schematicConnectivity`, and add `review` and `latestReview`
   with persistence, reuse when hashes match, and waivers applied on read. Add interface and
   export entries and the `rpc.ts` handlers. Extend `projectSettings.ts` for `review` merges.
   Extend `PcbPreviewService.test.ts`.
7. **Agent tools.** Add `loom_pcb_review` and the `review` object on `loom_pcb_check_settings`
   in `mcp.ts`. Update `mcp.test.ts`.
8. **Client runtime.** Add the `latestReview` query and `review` command. In `usePcbPreview.ts`
   add the review job.
9. **UI.** Show Checks for every design (`Inspector.tsx:114-124`). Add "Review" to the
   `ChecksView` kind switch and widen `onLocate`. Create `ReviewView.tsx` with the states from
   PRODUCT.md, the rule menu and waivers. Add the status chip. With L52, add `reviewFindings`
   to `findings.ts` and pass review findings to `CheckMarkers`.
10. **L58 hookup, if L58 landed.** Add `review` to `PcbAutoChecks`, a "Review" box beside ERC
    and DRC, `review` in `PcbCheckActivity.ranAt`, and run the review as the third kind in
    `autoChecks.ts`, with the same debounce and caps.
11. **Docs.** Add a "Review" paragraph to Checks in `docs/fork/user/pcb-preview.md`: what the
    rules look for, that they are heuristics, how to turn a rule off or ignore a finding, and
    that tscircuit designs now have Checks for Review. Put the false-positive notes for each
    rule in a comment above its matcher, not an internal doc.

## Done when

- On a KiCad design and a tscircuit design, "Run review" lists findings for each fixture's
  intended problem and nothing for the clean fixtures.
- Every finding shows a message, "Why", parts and "Locate"; "Ignore here" hides it, "Show
  ignored" brings it back and "Stop ignoring" restores it, without a rerun.
- A rule turned off for the project produces no findings and shows as off in the menu.
- Changing the decoupling distance reruns with the new value; an invalid value falls back with a
  notice.
- `loom_pcb_review` returns the same findings; a second call with no change reuses the stored
  result.
- With L52, review markers show and `.` steps through them with ERC and DRC.
- No regulator limit finding comes from an entry with `checkedOn: null`.
- Every TESTING.md command passes.
