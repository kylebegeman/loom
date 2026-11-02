# Development tools

Open **Development** from the panel picker or **Open development tools** in the command
palette. Browser also offers **Run and manage this checkout** before opening a page.

The Servers view finds your project actions, mapped dev command and common package scripts.
Start a command, inspect its output, open the detected address, and stop or restart the run.
**Show terminal** opens its original terminal. **Add logs to message** puts the output in a
draft for you to review. Project environment settings apply when starting a command.

Runs belong to a checkout on an execution computer. Conversations using that checkout see
the same runs; separate worktrees can run independently. Stopping another conversation's run
asks first. Runs stop when their terminals close or the Loom server shuts down.

A listening address appears when the computer can associate the process with its terminal.
A command can run without opening a web port. Preview links use your computer's existing
sharing configuration, including when you open a remote app from another device.

**Browser diagnostics** reads the console and network events Browser has already captured
for a tab in the conversation. Refresh to read the latest entries, filter errors, or add the
visible entries to a message draft. Reading diagnostics leaves page control with its current
owner. URLs omit query strings and embedded credentials. **Clear view** hides earlier entries
in this view; it preserves Browser's capture.

## Development services

The Services view needs Docker running on the execution computer. Servers and Browser
continue working when Docker is unavailable.

Compose uses an isolated project name for each checkout. Start or stop its stack, restart it,
and inspect recent logs and service health. Stopping a stack preserves its data volumes.
Explicit container names and external or globally named resources are refused because they
would share resources outside that checkout.

Create a local Postgres or Redis-compatible Valkey database for this checkout. Its port binds
to the execution computer's loopback, and its password stays in that computer's secret store.
**Copy connection URL** copies a credential-bearing URL for use on that computer. It does not
make the database reachable from your phone or another computer.

Stop preserves the database. **Remove, keep data** removes its container and keeps its data
volume and credential. Create or restore the database to reuse them. **Delete data** asks
before permanently deleting the owned volume. Other checkouts' resources are preserved.
Development databases remain in Docker until you stop or remove them.

Agents can inspect and manage the same runs and services with the `loom_dev_*` tools,
including while you use Loom on your phone. Web and desktop have the Development panel;
the native phone app uses conversation tools and existing preview links.
