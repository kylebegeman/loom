# L58: Checks after every save

Status: Ready to build

Approved by Kyle on 2026-10-10.

Turn on "Check after each save" for a project and Loom re-runs ERC, DRC or both whenever a
KiCad design's files change, about two seconds after the last save. The status bar reports what
moved since the previous run, "DRC: 2 new, 5 resolved", and Checks marks the new findings. Runs
happen on the environment host while the design is open in any client or when an agent reads
the checks, one at a time, and a newer save cancels a run that is already out of date. A run
you start yourself always wins. Agents get the same new and resolved lists from
`loom_pcb_check` and `loom_pcb_latest_checks`, so an agent can fix a DRC error, save and see
that it is gone without asking you to press anything. The setting is off by default.

## Scope

- In:
  - A per-project setting with ERC and DRC switches, stored on the environment, default off.
  - A server scheduler: 2 s debounce after a saved change, one automatic run at a time on the
    environment, superseded runs interrupted, manual runs take precedence.
  - Runs only while a client watches the design (the panel is open on it) or an agent asks.
  - A stable finding identity and a delta (`added`, `resolved`) on every check result,
    automatic or manual.
  - A small activity stream so open panels learn about runs they did not start, including
    agent-run checks (which today do not refresh an open panel).
  - Status bar and Checks copy for running, new and resolved, and paused states.
  - CPU caps: pause a check whose last run took over 60 s, never retry a failed run on the same
    saved files, and run nothing for designs nobody is looking at.
  - MCP: delta in results, `ensureFresh` on `loom_pcb_latest_checks`, and a
    `loom_pcb_check_settings` tool. `t3 pcb` gets both through the existing mapping.
- Out:
  - tscircuit designs. They have no ERC or DRC (L24); L68's review rules may join the setting
    later (see Relationship).
  - Checks while nothing watches the design. Loom does not watch every project's files in the
    background.
  - Notifications outside the panel (toasts, OS notifications). The status bar and the agent
    tools are enough for a first version.
  - Mobile. It has no PCB panel.

## Surfaces

- Web and desktop: supported. The setting lives in Checks; results show in the status bar and
  Checks.
- Mobile: not supported. Mobile has no PCB panel, so nothing changes there; runs started for a
  desktop client or an agent still persist on the environment.
- Remote: works over LAN, Tailscale and T3 Connect. Runs happen on the environment host; the
  client receives a few hundred bytes of activity per run and fetches results through the
  existing `latestChecks` query.
- Upstream T3 server: no PCB panel.

## Extension points used

L24's existing points only: `ext-core` (contracts, RPCs, the subscription tag list),
`ext-panels` (the PCB panel), `ext-mcp` (tools and the `t3 pcb` CLI). No new extension point.

## Packet seams

None. Every change is in fork-owned files. [SEAMS.md](./SEAMS.md) lists the shared fork files.

## New dependencies

None.

## Relationship to other follow-up packets

- L52 (check markers): this packet needs a stable finding id. L52 defines `findingId` and keeps
  item uuids in `kicadReports.ts`. If L52 has not landed, build exactly that part of L52
  (TECHNICAL.md, "Finding identity") in the same place; L52 then reuses it. With L52, findings
  in `delta.added` get an extra ring on the drawing; without it, they get a "New" badge in the
  list only.
- L68 (review checks): stores its rule switches in the same per-project settings record this
  packet creates (`PcbProjectSettings`), with its own decoding default. When L68 lands it may
  add `review` to `autoChecks`; the scheduler treats it as a third kind. Whichever of L58 and
  L68 lands first creates `projectSettings.ts` and the settings RPC pair as written here.
- L64 (fab check): could join the setting the same way; not planned.
- L54 (units): independent. Deltas compare ids, not positions shown to the user.
- L60 (change highlight): independent. L60 shows what changed in the design; this packet shows
  what changed in the findings.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
