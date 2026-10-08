# L23 implementation status

Complete and integrated on `main` for Loom `0.0.46-nightly.20261007.2787`. This closes the original L23
scope, workspace redesign, five selected editing additions, final audits and release
integration. Print readiness and slicing remain deferred.

| Work                        | Completion                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared integrations         | Existing core, panel, palette, root and keybinding registries reused; missing settings and MCP registrations added.                             |
| File preview                | Signed remote transport, discovery, STL/3MF/OBJ/glTF/GLB, on-demand rendering, build volumes and explicit loading/error states.                 |
| OpenSCAD                    | Real CLI rendering, customizer parameters and sets, worktree-scoped persistence, logs, cancellation, cache and dependency reload.               |
| Workspace design            | Floating viewport tools, responsive/maximized inspector, searchable library and parameters, precise controls and paused/manual preview.         |
| Selected additions          | Parameter history, measurements/sections, named views/capture presets, variant workbench and annotation/review workflows.                       |
| Agent/composer integrations | Current/four/named-view captures, persisted attachments, prepared review requests and two gated shared MCP tools.                               |
| Final audit                 | Resource/cancellation cleanup, persistence isolation, source provenance, cache/subscription races and progress feedback covered by regressions. |
| Documentation/tracking      | Product and technical records reconciled; user help and validation limits recorded; queue/index identify completion and release.                |

[TESTING.md](./TESTING.md) contains the checks and known verification limits.
[SEAMS.md](./SEAMS.md) records upstream touches and merge-review constraints. A clean-main
integration against the current upstream nightly is complete. Print readiness and slicing
remain deferred by Kyle; no other packet is started by closing L23.
