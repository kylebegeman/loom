# LoomOS implementation packets

Kyle selected every proposal except original major idea #14. This records implementation authorization, not completion. Original idea numbers are stable. #14, Saved project workspaces, is excluded.

The canonical packet data is [packets.json](packets.json). Read the [interactive review](index.html), or open individual packets below. Regenerate these views with `node deploy/omarchy/packets/render.mjs`; verify consistency with `--check`.

## Boundaries

- Preserve native Omarchy shell, pixel character and Iris skin.
- All AI uses Switchboard; reuse upstream T3 execution and remote access.
- Office and Atlas remain the same cross-platform products and own their data, permissions and offline behavior.
- No saved project-workspace bundles, layout restoration or new project association system from #14.
- Preserve concurrent work and never bypass the secure lock.
- Publish reusable Iris changes when a new version is needed across consumers.

## Execution order

Dependencies determine this order; independent packets can proceed when useful. Laptop hardware acceptance and deployment may wait for the machine. Approved does not mean implemented.

| Packet                                                                               | Status               | Dependencies    |
| ------------------------------------------------------------------------------------ | -------------------- | --------------- |
| [1. Discoverable Loom action menu](01-discoverable-loom-action-menu.md)              | verification_pending | None            |
| [6. Shortcut and accessibility presets](06-shortcut-and-accessibility-presets.md)    | ready_for_deployment | #1              |
| [9. Omarchy compatibility checks](09-omarchy-compatibility-checks.md)                | ready_for_deployment | None            |
| [12. Shared app integration contract](12-shared-app-integration-contract.md)         | verification_pending | None            |
| [2. Exact-item search opening](02-exact-item-search-opening.md)                      | verification_pending | #12             |
| [3. Destination-aware capture](03-destination-aware-capture.md)                      | approved             | #12             |
| [4. Guided connections](04-guided-connections.md)                                    | approved             | #1, #12         |
| [5. Capability-aware availability](05-capability-aware-availability.md)              | approved             | #4, #12         |
| [8. Iris consistency](08-iris-consistency.md)                                        | approved             | #9              |
| [7. Respectful actionable notifications](07-respectful-actionable-notifications.md)  | approved             | #2, #12         |
| [10. Reproducible LoomOS setup](10-reproducible-loomos-setup.md)                     | approved             | #4, #6, #8, #9  |
| [11. Contextual actions and AI workbench](11-contextual-actions-and-ai-workbench.md) | approved             | #3, #12         |
| [13. Native workstation control desk](13-native-workstation-control-desk.md)         | approved             | #2, #7, #12     |
| [17. Coordinated updates and recovery](17-coordinated-updates-and-recovery.md)       | approved             | #9, #10, #13    |
| [16. Coherent offline ecosystem](16-coherent-offline-ecosystem.md)                   | approved             | #12             |
| [15. Laptop/workstation continuity](15-laptop-workstation-continuity.md)             | approved             | #2, #4, #5, #16 |
| [18. Resilient private AI hub](18-resilient-private-ai-hub.md)                       | approved             | #4, #5          |
