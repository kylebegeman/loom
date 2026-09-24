# L11 product

## Problem

When an agent works on a web app, Kyle juggles terminals for the dev server and the database,
guesses which port the server took, and cannot see the page's console errors without detaching
DevTools (which, in the desktop app, also cuts off the agent's own console capture). Old Loom
had dev server, Docker, database, HTTP lab and diagnostics panels; two were real, two were thin
or fixture-only. Upstream T3 Code's new preview is better than old Loom's (pick and annotate,
port discovery, agent automation), so this packet adds the missing pieces around it instead of
replacing it.

## What the user can do

- Open **Dev environment** from the right panel launcher, the "+" menu, the command palette, a
  keybinding, or the dev dock's servers chip.
- **Servers:** see the project's runnable servers, start one (it runs in a thread terminal you
  can open), see when it is listening and on which URL, open it in the preview, restart it, stop
  it. Use varlock to load environment variables when the project has an `.env.schema`.
- **Compose:** see the project's compose services and their state, bring the stack up or down,
  restart a service, read its recent logs or follow them in a terminal.
- **Databases:** start a local Postgres or Redis for this project in one click, copy its URL,
  stop it when done, remove it (optionally deleting its data).
- **HTTP lab:** send a request to the dev server or any URL the environment can reach, read the
  status, timing, headers and body, repeat a request from history, add an exchange to the
  composer.
- **Dev dock** (desktop, under the preview page): see how many errors and failed requests the
  page produced; expand to read the console (with levels and source locations) and the network
  list (method, status, type, duration); filter; clear; send the errors to the composer as
  context.
- Let agents fetch pages as Markdown with Obscura when it is installed; choose whether it obeys
  robots.txt (on by default) and whether it may reach private network addresses (off by default,
  loopback always allowed).

## Entry points

| Entry                                                             | What it does                                                                                                                                                    | Way out / state                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Right panel launcher and "+" menu: "Dev environment" (letter `V`) | Opens the panel for the active thread's project.                                                                                                                | Close the tab; servers and containers keep running. |
| Dev dock servers chip (in the preview)                            | Shows "2 servers running"; click opens the panel.                                                                                                               | n/a                                                 |
| Dev dock bar                                                      | Click or `loom.browser-dev-tools.toggle-dock` expands or collapses the dock; the height is remembered.                                                          | Collapse.                                           |
| Command palette                                                   | "Dev environment: Open", "Start dev server" (submenu of candidates), "Stop all dev servers", "Toggle dev dock", "Send console errors to composer".              | The reverse actions are listed next to each.        |
| Keybinding commands                                               | `loom.browser-dev-tools.open`, `loom.browser-dev-tools.toggle-dock`, `loom.browser-dev-tools.start-default-server`, unbound by default.                         | Same.                                               |
| Settings, Loom page, "Dev environment" section                    | Obscura path, obey robots, private network fetch, agent fetch tool on or off, database images, dev dock on or off, HTTP lab history size, "Clear HTTP history". | Toggle back.                                        |
| Composer                                                          | "Add to composer" in the HTTP lab and "Send errors to composer" in the dock insert text context.                                                                | Remove from the draft.                              |
| Agent tool                                                        | `loom_browser_dev_tools_fetch`.                                                                                                                                 | Turn off in settings.                               |

## States

- **Loading**: skeleton rows per section.
- **Empty**: "No dev scripts found. Add one in Project settings, Actions, or in package.json."
  (servers); "No compose file in this project." (compose); "No local databases yet." with the
  two create buttons.
- **Docker missing or not running**: compose and databases show "Docker is not available on
  this environment" with the probe's error (for example the daemon not running). Servers and the
  HTTP lab are unaffected.
- **Starting**: server row shows "Starting" until a port appears or 60 seconds pass (then
  "Running, no port detected yet").
- **Exited**: "Exited with code 1" and the output tail, with Restart.
- **Pulling image**: database creation and `compose up` stream their output lines.
- **Dock**: collapsed bar with counts; "Console capture starts when the page loads" before the
  first message; "This tab's page is not loaded" when the preview is empty.
- **Disabled**: server lacks `browser-dev-tools`: panel launcher disabled with its hint, palette
  entries hidden; the dock still works (desktop-local) but hides server chips.

## Surfaces and connection modes

The panel is the same on web and desktop; the dock is desktop-only because the preview is. All
server, compose, database and HTTP lab work runs on the environment host, so it follows the
environment over LAN, Tailscale and T3 Connect. A database's URL points at the environment
host's loopback (`127.0.0.1:<port>`); for a remote environment the panel says so ("reachable
from the environment host and its agents, not from this computer"). Mobile shows nothing.

## Decisions and open questions

Decisions:

- Dev servers run in thread terminals, not hidden processes, so they appear in the terminal
  drawer, upstream's port discovery links URLs to them, and agents see the same terminals.
- Only one start per server key per project at a time; starting from another thread shows
  "Already running in thread X" with "Show".
- Database passwords are generated per database and kept in the server secret store, never in
  SQLite or the client's storage.
- The HTTP lab runs requests on the environment host and needs the `terminal:operate` scope,
  since it can reach anything the host can.
- The dock reads console and network events through Electron APIs that do not attach a debugger
  (`console-message`, `session.webRequest`), so it never conflicts with upstream's agent
  automation, which owns the webview's debugger.
- Obscura is optional and user-installed; Loom never downloads it.

Open questions for Kyle:

1. Default database images: `postgres:17-alpine` and `redis:7-alpine` (both configurable). Would
   you rather default Redis to Valkey (`valkey/valkey:8-alpine`, BSD) given Redis 7.4+ licensing?
2. Should a dev server started from one thread be stoppable from any thread of the project (the
   design says yes)?
