# L11: Development tools

Status: First two slices landed on main. Service, authorization, tool-use and local
Docker lifecycle and integrated web-client checks pass. Kyle selected these
slices on 2026-11-02: checkout dev servers and Browser diagnostics, then Compose and local
databases. The HTTP request lab remains a separate planned follow-up.

Development builds on existing project actions, terminals, port discovery, Browser captures,
project environment profiles and preview links. A run belongs to a checkout on a computer;
conversations sharing that checkout share its runs, while other worktrees stay independent.
The UI and supported `loom_dev_*` tools call the same services.

## Delivered scope

- Discover and run project actions, the profile's dev command and common package scripts.
- Inspect startup, running, listening, exit and stopped states, bounded logs and the exact
  original terminal. Restart and stop only recorded runs; confirm interference with another
  conversation on the same checkout. Reuse starts and retry receipts.
- Open detected addresses through existing Browser and preview-link behavior.
- Read existing Browser console/network captures, filter errors and add evidence to a message
  draft. Diagnostics preserve page control and redact URL credentials and query strings.
- Manage a checkout-isolated Compose stack, health and recent logs, preserving data on down.
- Create, start, stop and remove loopback-only Postgres and Valkey databases with owned data
  volumes and credentials in the computer's secret store. Preserve data by default; explicit
  data deletion is confirmed in the UI.
- Web/desktop Development panel, panel picker, command palette and Browser entry point.
  Native phone users can use the supported agent tools and existing preview links.

## Remaining scope

The HTTP request lab, full API-client capabilities and database browsing are not part of
these two slices. The lightweight request lab remains planned; full API and database studios
remain independent products. Additional container administration outside checkout development
is outside L11.

Obscura page fetch remains retired by Kyle's 2026-10-09 decision. Existing browser/provider
fetch tools already cover that use.

## Integration

Fork code lives under `browser-dev-tools`. Existing Browser owns capture and its debugger;
L11 registers a bounded read adapter. No second collector or Electron debugger is created.
The shared fork RPC, service, MCP, panel and palette registries carry the feature.

See [PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md),
[SEAMS.md](./SEAMS.md), [TESTING.md](./TESTING.md) and
[user help](../../user/browser-dev-tools.md).
