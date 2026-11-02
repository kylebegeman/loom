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

## HTTP requests

Open **HTTP requests** in Development to send a request from the checkout's execution
computer. Localhost addresses refer to that computer. Choose a method, URL, headers and
optional raw body, then send. The result includes status, timing, headers and a body preview.
Redirects are shown without being followed. Request bodies are limited to 128 KiB and response
previews to 256 KiB; binary responses show their captured size. Timeouts can be set up to
60 seconds.

The latest 50 exchanges are saved on that computer for the checkout. Select one to inspect
its response, then use **Load request** to prepare its fields for another send. Authentication
headers and common credential query fields are redacted in saved exchanges and omitted when
loading a request, so restore authentication before sending again when needed. Request and
response bodies remain part of the saved exchange. Other worktrees have their own history.

**Add response to message** inserts an excerpt into your draft. **Clear history** removes
saved payloads for all conversations sharing this checkout. Clearing does not undo requests
already sent. A small set of request-ID receipts remains so a retry after a lost response
does not automatically send the operation again. Requests whose outcome is unavailable are
reported explicitly.

Sending requests and reading their history require execution access. Agents use
`loom_dev_request`, `loom_dev_request_history` and `loom_dev_request_clear` for the same
workflow. Older connected computers without this capability hide the HTTP tab until updated.

### Saved APIs and environments

Choose **Saved APIs** in HTTP requests, open **Import a workspace**, give it a name, and
select that workspace's native Hoppscotch collection and environment JSON files together.
Keep separate API projects in separate workspaces. Reimporting the same name and files reuses
the imported workspace. Your source files stay unchanged. Imports accept collections version
12, requests version 17 and environments version 2, up to 16 MiB per file and 64 MiB together.

Browse collection folders or search by endpoint name, folder or method. Select an endpoint,
then explicitly choose an imported JSON environment, a dotenv file from this checkout, or
**No environment**. Loom uses that source without adding the computer's process environment.
Missing variables stop the request. Hoppscotch secret values omitted from an export remain
empty until supplied.

Open **Variables**, search for a key, edit its value, and save before sending. Secret values
are masked. Saving a JSON environment updates Loom's imported copy. **Save to .env file**
updates the selected checkout file while preserving its comments and unrelated definitions.
New variables can be added. Refresh variables to discard local edits and read current values.
A concurrent change requires a fresh read before saving or sending.

**Send endpoint** runs its preparation scripts, sends one request, and runs response scripts
for captures and checks. Preparation failure prevents dispatch. Supported legacy script APIs
include `pw.env.get/set/unset`, `pw.response`, `pw.test`, and common `pw.expect` assertions.
Scripts have time and memory limits, and no ambient filesystem or network access. Scripts
requiring other APIs report failure; they are preserved in the imported source.

Basic and Bearer authentication, inherited collection headers/authentication, query parameters,
JSON/text bodies and URL-encoded forms are supported. Binary upload requests ask for a file up
to 128 KiB. Multipart bodies and other authentication encoders remain unsupported and fail
before dispatch. Response previews use the same limits and history as one-off requests.

Captures update the selected JSON environment. For dotenv sources, captures stay in request
variables tied to that checkout file and its current contents; **Save to .env file** explicitly
writes them. Switching sources keeps their values separate. A file changed during a request
keeps its newer values.

**Remove imported workspace** removes Loom's copy and saved variables after confirmation;
original exports and HTTP history remain. API workspaces live on the execution computer and
do not yet synchronize through the Library. Native phone users can ask an agent to import,
inspect or send using `loom_dev_api_workspace`, `loom_dev_api_environment` and
`loom_dev_api_send`. Importing a pack does not run its requests.
