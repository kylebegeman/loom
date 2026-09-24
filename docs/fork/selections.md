# Loom: features selected from old Loom

Recorded 2026-09-24; outcomes and packet IDs added the same day. These are the panels and
features chosen from old Loom (`bagelvault/loom`, final release 0.13.10) to rebuild in this
fork as additive, fork-owned features. This file only records the choices; each item gets
its own design and documentation pass before any code. Old Loom is a reference, not a source
to copy: its server exposed about 100 capability areas and its own thread engine, where T3
Code has 10 areas and a different engine.

## Panels

| ID  | Panel                                  | Notes                                                                                                                                                      |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Snippets                               | Pairs with F1.                                                                                                                                             |
| P5  | Threads: related threads and Pair mode | Parent, child and sibling threads; two threads side by side with a merge step. F16 parts 1 and 2 (L02).                                                    |
| P6  | Thread Inspector                       | Status card for branch, worktree, changes, plan and approvals; can be pinned. Client-only in old Loom.                                                     |
| P7  | Source control: lanes, graph, CI       | Lanes, branch graph, CI checks, conflicts, safe branch switching. Pairs with F13. T3 already covers pull request review.                                   |
| P8  | File Outline                           | Symbol list for the open file. Client-only in old Loom.                                                                                                    |
| P10 | Bottom dock                            | Build each tab as its own feature, one at a time: tasks, activity ledger, approvals and the rest. T3 has only a terminal drawer today.                     |
| P11 | Swarm dock                             | Project-wide view of multi-agent runs.                                                                                                                     |
| P12 | Device extras                          | Build and install, evidence capture, scripted UI checks. Expand with the new headless Xcode and simulator tooling. T3 already has the device panel itself. |
| P13 | Browser extras                         | Dev servers, Docker, local databases, HTTP lab, console and network diagnostics, inside the browser panel.                                                 |
| P14 | Panel picker                           | Streamlined and far more compact than old Loom's catalog.                                                                                                  |
| P15 | Composer drawers                       | Per-turn tool overrides and clipboard history.                                                                                                             |

## Features

| ID  | Feature                               | Notes                                                                                                                                               |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Snippets library                      | Search as you type with live results. Old Loom had `;alias` + Tab expansion, fill-in fields, revision history, import and export, and terminal use. |
| F2  | Thread fork, manual compaction, goals | Fork from any message, compact on demand for every provider, pinned goal passed to the agent.                                                       |
| F3  | AI code review                        | Selected, with a separate brainstorm on how it should work before any design.                                                                       |
| F4  | Utilities catalog                     | Offline developer tools in a panel. First listed as not selected; now L27.                                                                          |
| F5  | In-app provider sign-in and setup     | Old Loom's final in-app sign-in and setup flow for providers, including the Codex tools page and config import.                                     |
| F6  | More providers                        | Gemini, GitHub Copilot, ACP agents, OpenAI-compatible endpoints (DeepSeek), Ollama, LM Studio.                                                      |
| F7  | Auto-resume after usage limits        | Continue a thread when a provider limit resets. First listed as not selected; now L28.                                                              |
| F8  | Chat conveniences                     | Find in thread, clipboard history, Mermaid diagrams, file outline, model picker presets, answering a provider's question without stopping it.       |
| F11 | Project profiles                      | Per-project commands, tools, budgets and defaults beyond what T3's project settings cover.                                                          |
| F12 | Repository Estate                     | Reshaped around the ephemeral workspace: clone into `~/Developer/active`, adopt as a project, park safely when done, reopen later.                  |
| F13 | Lanes board and Git cockpit           | Deferred; P7 covers the per-thread view (L06).                                                                                                      |
| F21 | Apple tooling                         | XcodeGen, XCResult summaries, release readiness; pairs with P12.                                                                                    |
| F23 | Small extras                          | Configurable worktree branch prefix, container logs, and a CLI tool registry.                                                                       |

## Outcomes of the open items

Items that were under consideration or still being discussed when this page was first
written, and where each ended up:

| Item                                         | Outcome                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Skill registry, manager and creation lab     | Selected as packet L21.                                                    |
| 3D modeling (Blender, OpenSCAD) for printing | Split: an in-Loom 3D preview (L23), the workbench as the Fabrication app.  |
| KiCad circuit board design and management    | Split: an in-Loom PCB preview (L24), the workbench as the Electronics app. |
| Image generation and photo lab               | Standalone app (Image Lab).                                                |
| Headless web scraper (Obscura)               | Standalone app (Web Scraper); L11 can use Obscura if installed.            |
| Research workspace (notebooklm-py)           | Standalone app (Research Desk).                                            |
| F9 orchestration tools for agents            | A tiny version (delegate to other threads) is part of L08.                 |
| F10 context engine                           | Skipped.                                                                   |
| F13 lanes board and Git cockpit              | Deferred. P7 (lanes, graph, CI for one thread) is L06.                     |
| F16 pair mode                                | Parts 1 and 2 (related threads, side by side) are part of L02.             |

## From selection to packet

Each selected item is built as an implementation packet under
[packets/](./packets/README.md). F4 and F7 were first listed as not selected and are now
packets L27 and L28. L22, L25 and L26 were not in the original selection; they came from the
review of the reference repositories below.

| Packet | Selection                           | Packet | Selection         |
| ------ | ----------------------------------- | ------ | ----------------- |
| L01    | P1, F1                              | L15    | F3                |
| L02    | P5, F2 (thread fork), F16 parts 1-2 | L16    | F5                |
| L03    | F2 (compaction, goals)              | L17    | F6                |
| L04    | P6                                  | L18    | F11               |
| L05    | P8, F8 (file outline)               | L19    | F12               |
| L06    | P7                                  | L20    | F23               |
| L07    | P10                                 | L21    | Skill registry    |
| L08    | P11, F9 (tiny version)              | L22    | Repository review |
| L09    | P12                                 | L23    | 3D preview        |
| L10    | F21                                 | L24    | PCB preview       |
| L11    | P13                                 | L25    | Repository review |
| L12    | P14                                 | L26    | Repository review |
| L13    | P15, F8 (clipboard history)         | L27    | F4                |
| L14    | F8 (the rest)                       | L28    | F7                |

## Standalone apps, specified separately

Each is its own app with a full MCP server, specified as an app packet in Kyle's workspace
docs (`~/Developer/docs/apps/`, index in its `README.md`). None depends on Loom.

| App packet        | What it is                                                              |
| ----------------- | ----------------------------------------------------------------------- |
| `api-studio`      | API Studio (F14): local HTTP and API client.                            |
| `database-studio` | Database Studio (F15): local SQLite and Postgres client.                |
| `scribe`          | Scribe: long-form writing with AI drafting, review and version history. |
| `torrent`         | A small self-hosted BitTorrent client based on `baairon/torlink`.       |
| `image-lab`       | Image Lab: image generation, editing and a searchable library.          |
| `web-scraper`     | Web Scraper: pages to Markdown, JSON, screenshots and diffs.            |
| `research-desk`   | Research Desk: sources, cited answers, summaries and audio overviews.   |
| `fabrication`     | Fabrication: 3D printing workbench from code CAD to printer control.    |
| `electronics`     | Electronics: PCB design workbench with tscircuit and KiCad.             |

## Not selected

P2 Context, P3 Work, P4 Runs, P9 Observer, F10 context engine, F17 Swarm bake-off, F18 Loop
Studio, F19 Work system, F20 voice dictation, F22 preview dev environments as a separate
system, the governance layer, and everything that depended on old Loom's cloud server.

## Reference repositories

Reviewed for reuse or inspiration: xtool-org/xtool, withastro/flue, block/buzz,
dmno-dev/varlock, PromptBranch/promptbranch, h4ckf0r0day/obscura,
software-mansion/argent, pbakaus/impeccable, Graphify-Labs/graphify,
teng-lin/notebooklm-py, DietrichGebert/ponytail, baairon/torlink.
