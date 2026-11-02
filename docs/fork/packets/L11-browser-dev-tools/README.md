# L11: Development tools

Status: The initial development tools, HTTP request lab and native API workspaces are implemented. Service,
authorization, tool-use and integrated web-client checks pass. Kyle selected these
slices on 2026-11-02: checkout dev servers and Browser diagnostics, then Compose and local
databases. Kyle continued with the HTTP request lab in the same workload.

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
- Send bounded HTTP requests on the execution computer, inspect status/timing/headers/body,
  reuse saved request fields, clear checkout history and add response excerpts to a draft.
- Import separate native API workspaces, browse their folders and endpoints, select JSON or
  checkout dotenv environments explicitly, edit variables and run preserved legacy scripts.
- Edit saved native requests with revision checks, export current portable JSON, and bind
  environment variables to exact-origin Vault secrets resolved privately at send time.
- Web/desktop Development panel, panel picker, command palette and Browser entry point.
  Native phone users can use the supported agent tools and existing preview links.

## Remaining scope

Native Hoppscotch workspaces add collection browsing, explicit imported JSON or checkout
dotenv environments, legacy preparation/response scripts and individual saved endpoint sends.
Workspace synchronization, collection runners, multipart bodies, expanded auth encoders and
database browsing remain follow-up work. Additional container administration outside checkout
development is outside L11.

Obscura page fetch remains retired by Kyle's 2026-10-09 decision. Existing browser/provider
fetch tools already cover that use.

## Integration

Fork code lives under `browser-dev-tools`. Existing Browser owns capture and its debugger;
L11 registers a bounded read adapter. No second collector or Electron debugger is created.
The shared fork RPC, service, MCP, panel and palette registries carry the feature.

See [PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md),
[SEAMS.md](./SEAMS.md), [TESTING.md](./TESTING.md) and
[user help](../../user/browser-dev-tools.md).
