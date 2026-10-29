# Project profiles and env

For Library projects, portable blueprints and workstreams, see [Projects](./projects.md).

Open **Settings > Projects**, choose a project, and find **Project profile** on its page.
Keep private notes there, map test/build and other command intents to existing project
actions or literal commands, and set optional token budgets. Profiles belong to that project
on that computer. They are separate from portable Library profiles and Vault bindings, and
create no files in the repository. Selecting several checkouts lets you edit them together;
unchanged fields keep each checkout's existing value. Offline checkouts do not receive
changes.

**Tools for agents** controls Hardware, Reach and Sites for the next agent session.
On mobile, open **Settings > Computer folders**, select the project, and choose the tools
for each computer.
**Automatic** shows hardware tools for tscircuit, KiCad or OpenSCAD projects, Reach tools
when your Library has a Reach zone, and Sites tools when the project links a site.
Choose **Always** or **Never** to override a family, or return to **Automatic**.
Resetting a profile also restores these choices to Automatic. The choices change which
tools the agent sees; they do not grant permission to use them.

Type `%` at the start of a word in any provider's composer to insert the notes as visible,
editable text. When the project has no notes, **Add project notes** opens its profile.
Agents can also read notes and command mappings with `loom_project_profiles_get`.
**Share profile with agents** is on by default, once per computer; turn it off to disable
that tool's profile access. Resetting the profile clears its notes, mappings and budgets.

Open the thread's **Env** panel, or use **Open project env** in the command palette, to
inspect `.env.schema` metadata and variable presence in that thread's checkout. Search and
filter the names to find missing or invalid variables. Env values, including public ones,
are never sent to clients or agents. Static inspection does not run configured functions
or contact secret managers. Schema files and local imports must stay inside the checkout.

**Validate with varlock** explicitly loads the project's configuration. Its first use on
a computer asks for confirmation because configured secret managers and code generators
can run. Cancelling runs nothing. Validation shows errors and replaces preview statuses
until **Refresh**. Varlock must be installed on the computer that owns the checkout.
Project actions and mapped commands can run through varlock in a new thread terminal;
stop them in that terminal. **Automatic** uses varlock when a valid schema and installed
varlock are available. **Never** runs the selected command directly.

Budgets are advisory and never stop a turn. The Env panel shows processed tokens for the
project today and the current thread. The day ends at the environment's local midnight.
Reported usage produces timeline notices at 80% and 100% of a budget. Providers that do
not report processed token usage cannot contribute to those totals. Accounting starts
when the feature is enabled; it does not backfill older turns.
