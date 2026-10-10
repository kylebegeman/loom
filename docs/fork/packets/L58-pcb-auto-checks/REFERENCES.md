# L58 references

Sources for this packet. Treat external repositories as references, not code to copy.

## Old Loom

No predecessor. L24's manual Checks flow is the starting point.

## Current Loom source

- Check run, timeout and persistence:
  `apps/server/src/fork/pcb-preview/PcbPreviewService.ts:1056-1155`
  (persist rule `:1139-1150`, timeout `:1092`).
- Latest checks: `PcbPreviewService.ts:1156-1169`.
- Watch stream, debounce and hash: `PcbPreviewService.ts:1170-1227` (350 ms at `:1214`).
- Tool locks: `PcbPreviewService.ts:223`; tool run wrapper `:302-350`.
- PubSub pattern: `workspaceBus` at `PcbPreviewService.ts:1229`, `workspaceUpdates` at `:2552-2567`.
- Workspace and project id: `PcbPreviewService.ts:285-300`.
- Scoped process spawn (interruption kills the tool): `apps/server/src/processRunner.ts:239-241`.
- Check contracts: `packages/contracts/src/fork/pcb-preview.ts:135-178`; methods `:15-43`; RPC
  group `:335-357`.
- Scopes: `apps/server/src/fork/rpcAuthorization.ts:21-46`; client guards
  `packages/contracts/src/fork/clientRpcPermissions.ts:10-23`; stream tags
  `packages/contracts/src/fork/rpc.ts:56-69`.
- Client runtime refresh today: `packages/client-runtime/src/fork/pcb-preview.ts:28-32`,
  `:154-158`, `:165-180`.
- Panel state and chips: `apps/web/src/fork/pcb-preview/usePcbPreview.ts:140-216`,
  `PcbPreviewPanel.tsx:665-674`, `:1356-1379`.
- Decoding default pattern: `packages/contracts/src/fork/model-preview-3d.ts:237`.
- MCP tools: `apps/server/src/fork/pcb-preview/mcp.ts:110-129`, `:349-365`; CLI mapping
  `cli.ts:13-15`.
- Tests with `TestClock` and `Deferred`: `PcbPreviewService.test.ts:280-298` and the watch test
  near `:496`.

## External

- KiCad CLI `sch erc` and `pcb drc` (`--exit-code-violations`, JSON output):
  <https://docs.kicad.org/9.0/en/cli/cli.html>. The exit code 5 for violations matches
  `PcbPreviewService.ts:1104`.
- KiCad JSON report schemas, item `uuid` field:
  <https://gitlab.com/kicad/code/kicad/-/tree/master/resources/schemas>. GPL-3.0; read only.
- Prior art, behavior only:
  - KiCad's own DRC and ERC dialogs run on request only; Loom found no "check on save" option
    in KiCad 9 or 10 (unverified against KiCad nightlies).
  - Editor language servers (for example TypeScript's `tsserver`) re-check after saves with a
    debounce and cancel superseded work; the scheduler copies that shape.
- Runtime numbers for ERC and DRC in TECHNICAL.md are estimates, not measured. Measure on a real
  board during the manual check and replace them if they are far off.
