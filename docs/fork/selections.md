# Loom: features selected from old Loom

Recorded 2026-09-24. These are the panels and features chosen from old Loom
(`bagelvault/loom`, final release 0.13.10) to rebuild in this fork as additive,
fork-owned features. This file only records the choices; each item gets its own
design and documentation pass before any code. Old Loom is a reference, not a
source to copy: its server exposed about 100 capability areas and its own thread
engine, where T3 Code has 10 areas and a different engine.

## Panels

| ID  | Panel                                  | Notes                                                                                                                                                      |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Snippets                               | Pairs with F1.                                                                                                                                             |
| P5  | Threads: related threads and Pair mode | Parent, child and sibling threads; two threads side by side with a merge step. See the F16 discussion.                                                     |
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
| F5  | In-app provider sign-in and setup     | Old Loom's final in-app sign-in and setup flow for providers, including the Codex tools page and config import.                                     |
| F6  | More providers                        | Gemini, GitHub Copilot, ACP agents, OpenAI-compatible endpoints (DeepSeek), Ollama, LM Studio.                                                      |
| F8  | Chat conveniences                     | Find in thread, clipboard history, Mermaid diagrams, file outline, model picker presets, answering a provider's question without stopping it.       |
| F11 | Project profiles                      | Per-project commands, tools, budgets and defaults beyond what T3's project settings cover.                                                          |
| F12 | Repository Estate                     | Reshaped around the ephemeral workspace: clone into `~/Developer/active`, adopt as a project, park safely when done, reopen later.                  |
| F13 | Lanes board and Git cockpit           | Pending a clearer definition; see the discussion notes.                                                                                             |
| F21 | Apple tooling                         | XcodeGen, XCResult summaries, release readiness; pairs with P12.                                                                                    |
| F23 | Small extras                          | Configurable worktree branch prefix, container logs, and a CLI tool registry.                                                                       |

## Under consideration

- Skill registry, manager and creation lab.
- Image generation and photo lab, possibly a standalone app.
- 3D modeling with Blender and OpenSCAD, for 3D printing.
- KiCad circuit board design and management.
- A headless web scraper (Obscura): a browser feature, a standalone app, or both.

## Still being discussed

- F9 orchestration tools for agents, F10 context engine, F13 lanes and Git cockpit,
  F16 pair mode.

## Standalone apps, specified separately

Each is its own app with a full MCP server, specified in Kyle's workspace docs
(`~/Developer/docs/specs/`): API Studio (F14), Database Studio (F15), Scribe (a
writing suite) and a torrent downloader based on `baairon/torlink`.

## Not selected

P2 Context, P3 Work, P4 Runs, P9 Observer, F4 Utilities catalog, F7 auto-resume
after usage limits, F17 Swarm bake-off, F18 Loop Studio, F19 Work system, F20 voice
dictation, F22 preview dev environments as a separate system, the governance layer,
and everything that depended on old Loom's cloud server.

## Reference repositories

Reviewed for reuse or inspiration: xtool-org/xtool, withastro/flue, block/buzz,
dmno-dev/varlock, PromptBranch/promptbranch, h4ckf0r0day/obscura,
software-mansion/argent, pbakaus/impeccable, Graphify-Labs/graphify,
teng-lin/notebooklm-py, DietrichGebert/ponytail, baairon/torlink.
