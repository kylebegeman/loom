# L21 seams

Existing core, panels, palette, settings, root and keybinding registries host the
feature in fork-owned paths.

| Upstream file                                           | Marker               | Purpose                                                                               |
| ------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `apps/server/src/provider/Drivers/ClaudeSkills.ts`      | `skill-registry` (2) | Export repository-root discovery and settings-path precedence for native enablement.  |
| `apps/server/src/provider/Drivers/ClaudeSkills.test.ts` | `skill-registry` (1) | Canonical fixture root for native registry selection, retaining explicit alias cases. |

The production seam changes visibility only, not discovery behavior. The test seam normalizes
the temporary fixture root to match native `process.cwd()` behavior. Keep it aligned with the
current provider implementation. Contracts and consumer typechecks catch API drift.
