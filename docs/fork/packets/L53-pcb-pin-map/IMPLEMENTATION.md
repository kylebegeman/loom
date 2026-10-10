# L53 implementation

Each step leaves the tree compiling. Commit at the end with
`feat(fork-pcb-pin-map): generate pin maps and firmware constants from a part`.

1. **Contracts, inspection fields.** Add optional `type` and `baseName` to `PcbPin` and optional
   `symbol` to `PcbComponent` in `packages/contracts/src/fork/pcb-workspace.ts` (TECHNICAL.md,
   Contracts).
2. **Generator.** Create `packages/contracts/src/fork/pcb-pin-map.ts` with the schemas and pure
   functions, and re-export it from `packages/contracts/src/fork/index.ts`. Write
   `pcb-pin-map.test.ts` alongside as you go (TESTING.md); it is the core of the packet.
3. **Netlist and board parsing.** In `apps/server/src/fork/pcb-preview/semantics.ts`, read
   `pintype` on board pads (`:82-89`) and netlist nodes, `libsource` into `symbol`, and
   `libparts` pin names into `baseName` in `mergeNetlist` (`:275-302`); set `symbol` from
   `ftype` in `inspectCircuitJson`. Before relying on alternates, export a netlist from a
   scratch STM32 schematic with an alternate assigned (outside the worktree, if `kicad-cli` is
   installed) and record in a code comment whether `pinfunction` shows the alternate; update
   REFERENCES.md item 3 with the answer.
4. **Service.** Add `apps/server/src/fork/pcb-preview/pinMap.ts` with the method body (inspect,
   hash check, build, validate names and format, render, save) and wire `pinMap` into the
   `PcbPreviewService` interface (`PcbPreviewService.ts:108`) and returned object (`:2591`).
   Save resolves the parent directory with `safePath` and writes with
   `writeFileStringAtomically`.
5. **RPC and permissions.** Add the method name and `Rpc.make` in
   `packages/contracts/src/fork/pcb-preview.ts`, the handler in `rpc.ts`, the scope in
   `clientRpcPermissions.ts` and `rpcAuthorization.ts`, and the client command in
   `packages/client-runtime/src/fork/pcb-preview.ts`. Extend the permission behavior tests.
6. **Agent tool.** Add `loom_pcb_pin_map` and its handler to `mcp.ts`; add the sentence to the
   `loom_pcb_inspect` description.
7. **Dialog.** Create `apps/web/src/fork/pcb-preview/PinMapDialog.tsx`; add the "Pin map"
   button to `InspectTab.tsx` (`:146-148`); thread `onPinMap` through `Inspector.tsx`; own
   `pinMapFor` and render the dialog in `PcbPreviewPanel.tsx`.
8. **Docs.** In `docs/fork/user/pcb-preview.md`, "Optional editor tools", add a short paragraph:
   select a part, press "Pin map", copy or save constants; GPIO numbers come from pin names for
   the four families, so check them against the datasheet before first power.
9. **Checks.** Run the commands in TESTING.md.

Done when: selecting an RP2040, an STM32 and a connector each produces a correct table and
files in every available format; saving writes the file, refuses to overwrite without
confirmation and does not reload the design; `loom_pcb_pin_map` returns the same rows and text
as the dialog for the same options; the focused tests, lint and typechecks pass.
