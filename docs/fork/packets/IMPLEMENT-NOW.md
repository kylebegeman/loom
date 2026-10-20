# Implement-now decisions

This is the entry point for selecting the next Loom packet. It overrides older build waves
and individual packet labels. Kyle completed this selection review on 2026-09-27. Only packets in the selected queue
are designated for implementation; retained proposals remain parked.

## Loom Vault implementation selection

Kyle authorized implementation of all sixteen Loom Vault packets on 2026-10-17 and selected
**self-hosted OpenBao** behind Loom's UI, identity model and agent broker. V01 to V16 remain
mapped to L73 to L88 in the [Vault index](./LOOM-VAULT.md). No packet was dropped.

L79 encrypted records and L81/L78/L73 grants, access explanations and server-context readiness
are **In progress** with local web/mobile flows and synthetic OpenBao verification. This chunk
delivers thread/project policy and inspection; the complete packet PRODUCT scopes stay selected.
L80 now adds reviewed public-key enrollment, permanent disable and online heartbeat presence
with web/mobile management and a foreground macOS/Linux runner. Hosted SSH/Git use is now
implemented below; GitHub account authentication and remaining delivery modes stay selected. The current readiness
check explicitly does not prove unattended SSH or provider authentication.
L85 now adds signed workload authorization-check sessions bound to active runs and current
use grants, with CLI/MCP cleanup. Existing provider/task launches now expose authenticated
tools with automatic on-demand session setup/release for hosted SSH and Git ref listing/fetch.
The server's enrolled broker must be configured and online. General terminal delivery remains pending;
L82 supplies the bounded SSH operation described below.

L82 now adds dedicated Ed25519 generation and independent trust replacement/removal, with keys
stored in OpenBao. Dual-proof runner requests execute bounded commands from the Loom server
through a strict host-bound SSH agent. Web/desktop and native mobile now provide dedicated
key creation, copying, reviewed host trust and a fixed authenticated connection test. Synthetic
web/iOS and disposable SSH/OpenBao checks pass. Real Git ref listing/repeated fetches also
pass with exact repository grants, wrong-pin/revocation/timeout denial and cleanup. Ordinary
terminal routing, clone/push and production registration remain unfinished.

L74/L76 now add searchable metadata references and environment/project-local SSH/Git profiles,
with web/desktop/native management and MCP/CLI named execution. First use durably pins run
selection and key versions; current grants, host trust, item state and profile archive remain
live checks. Full scopes remain In progress. Portable requirements now import/export without local bindings; other credential kinds stay selected. Explicit standalone Vault attachments now cover interactive/scheduled prompts and common
provider launch/steering preflight. Required profile versions and current grants are checked;
ordinary prompts skip Vault. Safe labels remain in transcripts. Scheduled status now follows
the exact latest Vault-attached provider run, with review and explicit retry. Portable SSH/Git
requirements export without local bindings and import into a fresh reviewed profile.
Retained selections now have paged administrator inspection and explicit terminal-run retirement.
Retirement replaces the current snapshot with a durable no-reselection tombstone; OpenBao history
remains. L83 adds dedicated github.com App/token management and scoped headless GH operations,
with repository grants, isolated CLI configuration and short-lived App token release attempts.
Both sections remain local milestones within the complete selected packet scopes.

GitHub requirements now bind dedicated connections/repositories in project profiles, pin versions
for each run, participate in launch preflight and execute by name. Version 2 portable declarations
carry requirement names/kinds without local bindings; SSH/Git-only exports retain version 1.
Configuration/grant checks deliberately do not claim live GitHub API or CLI readiness.

Explicit command-scoped terminal gh/Git HTTPS routing and provider-specific readiness are now
implemented locally. The wrapper preserves output/exit status, uses the selected connection and
repository, and rechecks current active-run authority. Web/mobile can check API, GH CLI and Git
HTTPS separately, select a thread and see denied or stale results. Persistent shell activation,
automatic credential migration and independent runner readiness remain selected work.

Managed broker startup/recovery is now implemented locally: plan/install/start/stop/restart/
status/uninstall for launchd GUI-user and systemd-user hosts, bounded retry after outage or
sealed OpenBao, terminal disable, preserved enrollment and separate process/autostart/linger/
heartbeat diagnostics. Native plist parsing, actual CLI subprocesses and isolated manager tests
provide local evidence. Linux/Pi execution and real login/logout/reboot acceptance remain pending;
no live service was installed. These host-local controls do not claim workload-use readiness.

The terminal-agent section is now implemented locally. Explicit `ssh-agent-exec` activation
runs ordinary SSH/Git, including clone/fetch/push, with a temporary local relay and live run,
version, host and SSH-use-grant checks. Real CLI/protocol/revocation and cleanup evidence passes.
Private keys remain on the server; repository-only grants retain the mediated Git boundary.
Pi and ACP terminal connections are recognized. A discovered OpenBao JSON-complexity limit is
fixed by a versioned, legacy-readable storage envelope; encrypted persistence/restore passes.
No live backend conversion, credential registration, service installation or deployment ran.

Kyle authorized completing all remaining Vault sections and landing the branch on 2026-10-20.
No additional section approvals are required. Native Codex/Claude terminal setup is implemented
with session-owned private connection files; focused native adapter/lifecycle checks cover
rotation, cleanup and readiness. All complete packet scopes remain tracked below. The runtime
publication gate is cleared: 0.0.85-nightly.20261019.3348 ships the MCP startup correction from
main `cc05b69aed`, with archive smoke passing on all three platforms. Kyle alone owns nightly
release cuts; this thread must not run `loom.sh land`.

Local implementation and synthetic testing are authorized. Deployment, changes to the live VPS,
production dependencies beyond the selected OpenBao service, personal-vault migration and
production credential registration are separate actions. Browser/device verification follows
the repository's explicit-authorization rule. This selection leaves non-Vault priorities below intact.

## Selected queue

| Order | Packet                                                | Status                                        | Decision                                                                                        |
| ----- | ----------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1     | [L23 3D preview](./L23-model-preview-3d/)             | Complete; Loom `0.0.46-nightly.20261007.2787` | Full L23, redesign and five selected editing additions verified; final audit closed 2026-10-07. |
| 2     | [L24 PCB preview](./L24-pcb-preview/)                 | Complete; Loom `0.0.46-nightly.20261008.2801` | Full packet plus eight editor features, 3D, library/reuse and MCP/CLI approved in this thread.  |
| 3     | [L10 Apple build tooling](./L10-apple-build-tooling/) | Complete; merged in PR #13                    | Kyle confirmed the full packet on 2026-09-27.                                                   |
| 4     | [L09 Device QA](./L09-device-qa/)                     | Complete; merged in PR #14                    | Kyle confirmed the full flow/evidence packet on 2026-09-27.                                     |
| 5     | [L27 Utilities](./L27-utilities/)                     | Complete; on main since 2026-10-20            | Kyle included the complete 29-tool packet on 2026-09-27.                                        |
| 6     | [L05 File outline](./L05-file-outline/)               | Complete; on main in `1daaebb2b9`             | Kyle included the complete selected language coverage on 2026-09-27.                            |

Order reflects product priority, not dependencies. An agent asked to choose the next item
starts with the first incomplete, unclaimed packet. Closing L23 does not start another project. Each packet can still be implemented independently.

All candidate dispositions are settled for the 2026-09-27 review. The comparison below retains
the reasons for selection or deferral; only the selected queue is available for implementation.
Every original 2026-09-27 selection is now implemented; L27 was the last. Later selections appear below.

Kyle added two packets on 2026-10-09, after V2 shipped in nightly:

| Order | Packet                                  | Status                            | Decision                                                                  |
| ----- | --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| 7     | [L12 Panel picker](./L12-panel-picker/) | Done; on `feat/loom-panel-picker` | Kyle included the full packet on 2026-10-09.                              |
| 8     | [L26 Code graph](./L26-code-graph/)     | Done; on `feat/loom-code-graph`   | Kyle included the full packet on 2026-10-09; it was deferred only for V2. |

Kyle selected the 3D and PCB follow-ups on 2026-10-10, leaving out goal-driven exploration,
mobile 3D, a new viewer core, simulation results on the schematic and parts sourcing:

| Order | Packets                                               | Status                                      | Decision                                                                |
| ----- | ----------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| 9     | [3D follow-ups](./MODEL-3D-FOLLOW-UPS.md), L31 to L51 | Documented; see the index for each one      | Kyle selected all 21 on 2026-10-10. Build in the suggested order there. |
| 10    | [PCB follow-ups](./PCB-FOLLOW-UPS.md), L52 to L70     | Nineteen implemented locally; see the index | Kyle selected all 19 on 2026-10-10. Build in the suggested order there. |

The first PCB batch, L54, L56, L55, L57 and L62, is implemented locally on
`feat/pcb-units-presets-stats-print-capture`. Focused checks passed; client, real-tool and
physical-print verification remain in each packet's testing notes. The rest of the selection
is unchanged. L52 is also implemented locally on the same branch, with focused report,
marker/navigation, capture and agent tests. Real-client and CAD verification remain pending;
L58 is implemented locally with host scheduling, project settings and agent/client result refresh. Real-client and CAD checks remain pending. L53 is also implemented locally with shared pin-map generation and guarded file exports. L59 is implemented locally with grouped turn designs and shared background tab opening. L60 is implemented locally with shared structural diff and drawing highlights. L69 is implemented locally with anchored requests, draft handoff and user acceptance. L68 is implemented locally with deterministic review, waivers and automatic review. L64 is implemented locally with editable fab profiles, isolated capability checks and cost drivers. L65 is implemented locally with KiCad/tscircuit fabrication packages, assembly conversion, checklist, package management and the documented preview fallback. L66 is implemented locally with thread-scoped design history, historical SVG/GLB viewing and whole-design restore with undo. L61 3D inspection tools and L63 accessibility are implemented locally, including agent measurements and heights, finding announcements and focus restoration. L67 enclosure generation and fit checks and L70 variant sweeps are implemented locally. All 19 selected PCB follow-ups are complete locally; real-client and CAD verification remains pending. The first history, 3D and accessibility batch is complete locally; real-client, CAD and screen-reader checks remain pending.

Each follow-up is an independent packet. One marked "Needs decision" in the
[packet index](./README.md#packet-index) waits for Kyle's answer to the question in its
PRODUCT.md; the others can start now. Fixes found while writing them are on the local
branches `feat/model-bed-picker` and `fix/preview-defects`; packets that touch the same code
say what to do when those commits are or are not on the base.

Kyle selected hosted previews on 2026-10-18 and approved the later slices on 2026-10-19:

| Order | Packet                                    | Status                                                          | Decision                                                                                                                                                                                                         |
| ----- | ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11    | [L72 Preview links](./L72-preview-links/) | Implemented on `main`; Library deploy and client checks pending | Slices 1 to 5 and the gap fixes are built. The `pages.bagels.top` record is live since 20 October 2026; the Library side waits on the LP-22 deploy. Slice 6, guest links, is parked under the one-operator rule. |

Kyle selected all Vault packets; stable V identifiers map to these collision-free packet IDs:

| Order | Packet                                                                                  | Status                                   | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12    | [L73 Headless readiness checks](./L73-vault-readiness/)                                 | In progress                              | Vault V01; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 13    | [L74 Searchable credential references everywhere](./L74-vault-references/)              | In progress                              | Vault V02; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 14    | [L75 Guided migration from personal credential stores](./L75-vault-migration/)          | Waiting on host policy                   | V03 parked; managed route plus capture codec starts only after CW-1 selects a primitive and L79 host policy is in place. All host writes remain refused.                                                                                                                                                                                                                                                                                                                  |
| 15    | [L76 Project environment profiles](./L76-vault-profiles/)                               | In progress                              | Vault V04; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 16    | [L77 Credential health and maintenance inbox](./L77-vault-health/)                      | In progress; restricted local acceptance | V05; local web outage/maintenance/history acceptance passed; SSH/GitHub adapters only. Native, live-provider and remote acceptance plus other adapters remain; external-consumer discovery is explicitly unavailable.                                                                                                                                                                                                                                                     |
| 17    | [L78 Explain access and preview changes](./L78-vault-access-inspector/)                 | In progress                              | Vault V06; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 18    | [L79 Encrypted Vault and self-hosted control plane](./L79-vault-core/)                  | In progress; waiting on deploy           | Vault V07; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 19    | [L80 Enrolled machines and headless brokers](./L80-vault-brokers/)                      | In progress                              | Vault V08; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 20    | [L81 Agent identities and persistent access grants](./L81-vault-grants/)                | In progress                              | Vault V09; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 21    | [L82 SSH key management and Loom SSH agent](./L82-vault-ssh/)                           | In progress                              | Vault V10; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 22    | [L83 Developer service accounts and authentication connectors](./L83-vault-connectors/) | In progress                              | Vault V11; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 23    | [L84 Test account collections and provisioning](./L84-vault-test-accounts/)             | Selected; remaining implementation       | Vault V12; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 24    | [L85 Credential delivery API, CLI, and runner integrations](./L85-vault-delivery/)      | In progress                              | Vault V13; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 25    | [L86 Remote approvals and temporary access](./L86-vault-approvals/)                     | In progress; first local milestone       | V14; timed approvals, requester lifecycle, retry/recovery checks, requester outcomes, named accessible review, gated durable journal, requester-safe recovery observation, journal-aware retry preparation and 24h/128 retention. Native iOS first milestone and approver-context pass accepted; synthetic retry integration, dispatcher proof, internal fresh acquisition and local adapter admission passed. Runtime dispatch, resumption and allow-once stay disabled. |
| 26    | [L87 Credential lifecycle automation and short-lived access](./L87-vault-lifecycle/)    | Selected; remaining implementation       | Vault V15; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 27    | [L88 Backup, recovery, and portability](./L88-vault-recovery/)                          | Selected; remaining implementation       | Vault V16; full scope selected.                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Candidates for the queue

Source review: 2026-09-27, Loom `e73fc8faca2cfbf1e1b0fafa1cd85ce37c508fff`.
This is a suitability review, not a claim that every implementation sketch has been validated.

| Packet                                                | Complete outcome                                                                          | Why consider it now                                                                | Readiness work before selection is final                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [L27 Utilities](./L27-utilities/)                     | All 29 offline tools, panel, palette, no-thread dialog and configurable shortcut          | Client-only; required dependencies and shared UI extension points already exist    | Complete on main since 2026-10-20; the manual client pass in TESTING.md is not yet run                                                                             |
| [L05 File outline](./L05-file-outline/)               | Search and navigate symbols in the open file across all selected languages                | Client-only; current file surface exposes loaded text and existing line navigation | Selected; current editor updates the file query on each edit, and existing openFile supports line navigation; language fixtures are required during implementation |
| [L01 Snippets](./L01-snippets/)                       | Saved library, fill-in fields, aliases, revisions, import/export and terminal insertion   | Owns prompt preparation, not agent execution                                       | Parked by Kyle's conditional decision: existing composer skill invocation covers named predefined workflows; see the packet README                                 |
| [L23 3D preview](./L23-model-preview-3d/)             | Mesh/OpenSCAD previews, live reload, parameters, captures and agent render tool           | Owns file rendering; does not replace orchestration or depend on Fabrication       | Complete, including settings/MCP integrations and real CLI/client verification; see L23 TESTING.md for limits                                                      |
| [L24 PCB preview](./L24-pcb-preview/)                 | PCB editor, checks, inspection, comparison, simulation, parameters, 3D and hardware reuse | Owns design-file rendering; does not depend on Electronics                         | Complete; real CAD/simulator execution and local editor checks; see L24 TESTING.md for limits                                                                      |
| [L10 Apple build tooling](./L10-apple-build-tooling/) | Build/test/run, result summaries, history, XcodeGen and readiness checks                  | Owns a build pipeline separate from agent turns                                    | Selected; current workspace/Device services checked; real build, test, cancellation and destination verification required during implementation                    |
| [L09 Device QA](./L09-device-qa/)                     | Recorded flow runs, snapshot diffs, evidence capture/history and agent tools              | Adds repeatable QA to the existing Device surface                                  | Selected; current access gating and deletion event checked; outdated Device toolbar seam refreshed; real flow/capture verification required during implementation  |

These are whole packets with their existing product scope. Do not quietly drop formats,
tools, platforms or entry points to make a candidate appear ready. Web and desktop are the
selected UI surfaces in these packets; remote use remains required and mobile UI remains
outside their scope. A future V2 port of ordinary workspace or panel integration may still
be necessary. Selecting a packet means its complete behavior is useful on current released
code, not that its integration will never change.

## L01 decision: use existing skills

On 2026-09-27 Kyle said to park Snippets if existing functionality provides equally quick
composer access to a predefined set of detailed instructions; otherwise include it, with
maintenance cost accepted. The current composer provides searchable `$` skill selection
(and skills in the `/` menu when enabled). A saved skill can contain the work definition,
formatting rules and do/don't guidance; selecting it inserts the invocation, and Kyle can
add task-specific text before sending.

Verified against the reviewed source: `ChatComposer.tsx` searches provider skills and inserts
`$name`; `ClaudeSkillDispatch.ts` translates a discovered skill mention into Claude's native
invocation; Codex receives its native skill mention. See upstream's
[composer guide](../../user/composer.md#commands-and-skills).

**Disposition: L01 parked, existing skills cover the stated need.** This is not a claim that
skills replace every snippet feature. Skills require one-time authoring and availability in
the selected provider/environment; they do not expand an editable prompt body or provide
L01's fill-in drawer and library UI. Reopen L01 if those differences matter in actual use.
Porting cost alone is not a reason to decline a feature Kyle finds valuable. No skills or
provider settings were created or changed during this decision.

## Additional proposals to keep parked

The previous review retained these product ideas, but that did not establish immediate
implementation readiness. Confirmed deferrals:

- **L21 Skill registry: confirmed deferred by Kyle on 2026-09-27.** Retain its full
  management/creation scope and revisit after V2 ships. Review released provider/account
  reports, enablement and test-thread behavior before choosing contracts. The existing `$`
  picker covers invocation, not this management UI. Do not build a partial file browser in
  the meantime; there is no deadline.
- **L26 Code graph: deferred by Kyle on 2026-09-27, included on 2026-10-09** once V2
  shipped in nightly (selected queue, order 8), and built on V2 events with the full code
  map, change-impact, agent-query and automatic-update scope.
- **L29 Jev hub: retired by Kyle on 2026-10-09.** Jev moved to its own project outside
  Loom, and Loom drops all Jev support. Do not implement it here.
- **L28 Auto-resume: retired by Kyle on 2026-10-09.** Switchboard, Kyle's external tool,
  already resumes rate-limited agents automatically.
- **L30 Loom plugins: designed and parked by Kyle on 2026-10-09.** Every feature becomes a
  plugin with one definition per layer and a per-environment switch in Settings. The packet
  is fully documented but not selected for implementation. The selected packets have
  landed and register the old way, so picking up L30 includes converting them. Re-verify
  its source citations before starting. See
  [L30](./L30-plugins/README.md#revisiting).

All packets already marked `Deferred: V2` in the [index](./README.md#packet-index) stay
deferred. L04 is archived following Kyle’s 2026-10-07 decision to hide its UI and
retain the implementation for reference.

## What qualifies as implement now

Before moving a packet into the selected queue, record Kyle's inclusion decision and settle
any product choices required to complete it. Refresh its technical, seam and testing notes
against current released source. The packet must define its complete outcome, supported
surfaces, dependencies/tool prerequisites, focused validation and any remaining constraints.
Record the reviewed commit and approved scope in its README. An unresolved contract or
product decision means `Needs planning`, not `Implement now`.

Reuse existing fork extension points. Add only the missing integration needed by the
selected feature; do not build infrastructure for parked features or unmerged upstream
proposals. A routine source adjustment is implementation work; a material scope change or
new upstream dependency returns the packet to planning with the reason recorded.

## Agent handoff

When asked to pick up an implement-now item:

1. Read AGENTS.md, FORK.md, this page, the packet index, conventions, relevant extension
   points and every file in the chosen packet.
2. Pick only from the selected queue. Check the working tree, branches and active work
   before starting; do not duplicate a packet already in progress. Record the owning branch
   and change its status to `In progress` in the existing packet index and README.
3. Check the relevant current source and package manifests against the recorded review.
   If V2 has landed or required contracts have materially changed, reassess before coding.
   Routine line movement does not require another product decision.
4. Implement the whole recorded scope, keeping other people's work intact. Run focused
   tests, relevant consumer typechecks, lint and the packet's applicable verification.
   Existing rules for browser/device verification, dependencies and external actions still
   apply; selection alone is not deployment, publishing or live-data authorization.
5. Record what passed and what remains in the packet's testing notes. Do not call a partial
   implementation done. Update the index and README with the actual status and handoff.

The queue is an implementation scope decision, not a guarantee that old source snippets
remain correct forever. An agent should be able to start without replaying this conversation.
