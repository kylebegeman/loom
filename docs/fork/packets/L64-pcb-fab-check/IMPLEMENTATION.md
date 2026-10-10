# L64 implementation plan

Ordered steps for one agent. Each step leaves the tree compiling.

## Before starting

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, PCB-FOLLOW-UPS.md and this
folder. The shared definition already includes `minEdgeClearanceMm` and `minHoleToHoleMm`.
Start from `main`. Check which of L52 and L55 have landed
(`apps/web/src/fork/pcb-preview/findings.ts`, `apps/server/src/fork/pcb-preview/boardStats.ts`).
Commits use `feat(fork-pcb-fab-check): ...`.

## Steps

1. **Contracts.** Create `packages/contracts/src/fork/pcb-fab.ts` as in TECHNICAL.md and export
   it from `index.ts`. Add the four methods to `PCB_PREVIEW_WS_METHODS` and
   `PcbPreviewRpcGroup` in `pcb-preview.ts`, and the scopes to `FORK_RPC_REQUIRED_SCOPES` and
   `FORK_CLIENT_GUARDED_RPC_SCOPES`. Add `pcb-fab.test.ts` for decoding defaults and limits.
   The server will not typecheck until step 4 wires the handlers, so add stub handlers in
   `rpc.ts` that fail with `unsupported-view` in this step.
2. **Built-in data.** Create `apps/server/src/fork/pcb-preview/fabData.ts` with `BUILT_IN_FABS`
   (values and notes from TECHNICAL.md and REFERENCES.md), `BUILT_IN_COST_RULES`,
   `GENERIC_COST_RULES`, `decodeFabCapabilitiesLenient` and `toCatalog`. Test in
   `fabData.test.ts`.
3. **Pure check helpers.** Create `fabCheck.ts` with `fabRules`, `rulesFile`,
   `clearBoardMinimums`, `FAB_RULE_TYPES`, `classifyViolations`, `boardFacts`,
   `boardFindings` and `costDrivers`. Test each in `fabCheck.test.ts` with small S-expression
   and JSON strings, plus `fixtures/fab/` (a board with a 0.15 mm via, a castellated pad, a
   via in an SMD pad and an ENIG stackup; a `.kicad_pro` with minimums set; a DRC report
   containing each fab type).
4. **Capabilities service.** In `PcbPreviewService.ts`, extract `isPlainHttpUrl` from
   `updateLibrary` and use it there. Add `fabFile`, `fabCapabilities` and
   `updateFabCapabilities` beside the library, to the interface (`:83-148`) and `of`
   (`:2568-2606`). Replace the stubs in `rpc.ts`. Service tests: defaults, conflict, built-in
   id collision, bad URL, bad default, a stored file with one bad entry.
5. **Check service.** Add `runFabCheck(deps, input)` to `fabCheck.ts` following TECHNICAL.md
   "Procedure", and `fabCheck` and `latestFabCheck` as call sites in the service. Service tests
   with a fake `run` that asserts the temporary `.kicad_dru` and `.kicad_pro` contents and
   writes a fixture report: classification, persistence, newer-wins, KiCad 9 without
   `--refill-zones`, tscircuit refused, the user's files unchanged byte for byte, temporary
   directory removed after failure and interruption.
6. **MCP.** Add the four tools to `mcp.ts` and cases to `mcp.test.ts`.
7. **Client runtime.** Add the atoms and commands to
   `packages/client-runtime/src/fork/pcb-preview.ts`.
8. **Web.** Add `fabCapabilities.logic.ts` with tests, then `FabCapabilitiesDialog.tsx`,
   `FabCheckView.tsx` and the third card in `ChecksView.tsx`. Add the settings row. With L52,
   feed fab violations to the markers; with L55, show measured minimums beside the limits;
   with L54, format lengths through its formatter.
9. **Docs.** In `docs/user/`, in the PCB preview section, a short "Check against a fab"
   paragraph: what it checks, that built-in limits carry a checked date and may be out of date,
   and how to add your own. Nothing in `docs/internals/`.
10. **Real-tool check.** Extend `realTools.test.ts` (opt-in) to run the fab check on a fixture
    board and pin the real violation `type` names and description format. If they differ from
    `FAB_RULE_TYPES` or the `actual` pattern, fix the constants and the unit fixture together.

## Done when

- A KiCad board with a 0.15 mm via drill fails JLCPCB standard with the via located, passes
  JLCPCB advanced, and lists the small-via cost driver.
- A 4-layer board fails OSH Park 2-layer on layer count and shows an area estimate for 4-layer.
- The user's board, project and rules files are byte-identical after a run.
- Duplicating, editing, defaulting and deleting a fab entry round-trips across clients, with a
  conflict message on a stale save.
- Agents can list fabs, save an entry and run the check through MCP and `t3 pcb`.
- Focused tests, lint and typechecks in TESTING.md pass; the merge check is clean.
