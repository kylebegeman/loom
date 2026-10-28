# L21 seams

Existing core, panels, palette, settings, root and keybinding registries host the
feature in fork-owned paths.

| Upstream file                                      | Marker               | Purpose                                                                              |
| -------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `apps/server/src/provider/Drivers/ClaudeSkills.ts` | `skill-registry` (2) | Export repository-root discovery and settings-path precedence for native enablement. |

The seam changes visibility only, not discovery behavior. Keep it aligned with the
current provider implementation. Contracts and consumer typechecks catch API drift.
