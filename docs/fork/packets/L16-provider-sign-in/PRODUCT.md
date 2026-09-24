# L16 product

## Problem

Kyle runs several Codex and Claude accounts side by side (`~/.codex_1` to `~/.codex_3` and
`~/.codex_api` as shadow homes over `~/.codex`; `~/.claude_1` to `~/.claude_3` and
`~/.claude_api` as Claude config directories). Upstream T3 Code documents that setup but
every step happens in a terminal on the environment's machine: create the folder, run
`CODEX_HOME=... codex login` or `CLAUDE_CONFIG_DIR=... claude auth login`, then add the
instance in settings. When a login expires on a remote environment, there is no way to fix it
from the phone or laptop that noticed. Old Loom solved this with in-app sign-in and Kyle
wants it back, working for account N as well as account 1.

## What the user can do

- See, for every Codex and Claude instance, whether it is signed in and as whom.
- Sign a Codex instance in with ChatGPT in the browser, with a device code on any device, or
  with an OpenAI API key.
- Sign a Claude instance in with a Claude subscription or an Anthropic Console account, or
  give it an Anthropic API key, later replace or remove that key (never see it again).
- Sign an instance out. Its running threads stop; thread history is kept.
- Add another Codex or Claude account in one flow: name it, Loom picks the next free folder
  (`~/.codex_4`, `~/.claude_4`), creates the instance and opens sign-in.
- Remove an account: sign out and remove the instance, and optionally move the folder Loom
  created out of the way.
- Be warned when two instances are signed in to the same account ("Same account as Codex 2").
- See at a glance that Codex stores logins in files (a green check), or be told, before
  signing in a second Codex account, that Codex uses the system keychain, and let Loom change
  that one line in `~/.codex/config.toml` after showing it and saving a backup.
- For a Codex instance, open **Codex tools**: see each MCP server's auth state, tool count
  and errors, reload MCP configuration, start an MCP server's OAuth sign-in, and turn Codex
  skills on or off.
- Import Claude Code configuration (MCP servers, skills, AGENTS.md from CLAUDE.md, commands,
  hooks, as Codex detects them) into a chosen Codex instance, choosing which items to bring.

## Entry points

| Where                                                   | What                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings > Providers, a Codex or Claude instance editor | "Account" section: status, Sign in, Sign out, method choice, device code, paste box. Codex instances also get "Codex tools" and "Import from Claude Code" rows.          |
| Chat: provider status banner and model picker           | Upstream's "Open provider setup" button appears for an unauthenticated Codex or Claude instance (the decorator sets `setup.canAuthenticate`) and opens the editor above. |
| Settings > Loom > Accounts                              | Every Codex and Claude instance on the selected environment with its account status, plus "Add Codex account" and "Add Claude account".                                  |
| Command palette                                         | "Sign in to <instance>" for each signed-out Codex or Claude instance; "Add Codex account"; "Add Claude account"; "Open Codex tools".                                     |
| Keybinding                                              | None. These are rare actions; the palette covers them.                                                                                                                   |

Ways out and ways to see state: Cancel sign-in (every waiting state), Sign out (reverse of
sign in), Remove account (reverse of add account), turning a skill back on, and the status
line in every place above. A failed or cancelled sign-in returns to the idle state with the
message kept until the next attempt.

## Flows

### Sign in to Codex (local)

1. Settings > Providers > Codex 2 > Account shows "Not signed in" and **Sign in**.
2. The method menu defaults to **ChatGPT in the browser** when the client runs on the
   environment's machine (desktop app, or web on localhost), otherwise to **Device code**.
3. Browser: Loom opens the ChatGPT page. The row says "Waiting for ChatGPT sign-in." with
   **Open sign-in page**, **Copy sign-in link** and **Cancel**. When Codex reports success the
   row shows "Signed in as kyle@example.com (Plus)".
4. Device code: the row shows the code in large type, **Copy code**, the verification link, a
   QR code of the link (upstream's `apps/web/src/components/ui/qr-code.tsx`), and "Enter this
   code at <verification link>." The link and code come from Codex; nothing is hard-coded.
5. API key: a password field and **Save key**. The key is sent once to the environment and
   stored by Codex in that instance's home; Loom does not keep it.

### Sign in to Codex from another device

The method defaults to device code. If the user chooses the browser method anyway, the row
adds: "Finish in a browser on any device. If the last page fails to load, copy its full
address (it starts with http://localhost:1455) and paste it here." Loom forwards that
address to the environment's own loopback listener.

### Sign in to Claude

1. Account section: **Sign in** with a choice of **Claude subscription** (default) or
   **Anthropic Console**, and a secondary **Use an API key** link.
2. Loom starts `claude auth login` for that instance's config directory and shows
   "Authorize in your browser." with **Open sign-in page** and **Copy sign-in link**.
3. Under it: "If Claude shows a code, paste it here." and a paste box with **Continue**.
   When the browser redirect reaches the environment directly, the box is not needed.
4. Success shows the email and subscription reported by Claude.
5. API key: a password field and **Save key**; saving writes `ANTHROPIC_API_KEY` as a
   sensitive environment variable on the instance through the normal settings update
   (upstream stores it in its secret store and never sends it back to a client), then
   refreshes status. Afterwards the row shows "An API key is saved for this account." with
   **Replace key** (a new password field) and **Remove key** (confirmation "Remove the API
   key from Claude 2? Claude will use its signed-in account, if any."). There is no way to
   show or copy the saved key.

A Claude instance whose environment sets `ANTHROPIC_BASE_URL` (a model endpoint or router,
for example one made by L17) shows "This instance uses a custom endpoint. Sign-in does not
apply; its key is in the instance's environment variables." and no sign-in buttons.

### Add an account

1. Settings > Loom > Accounts > **Add Codex account** (or the palette).
2. Dialog: name (default "Codex 4"), color, and the folder Loom will use, shown read-only
   with **Change folder** for an advanced path. For Codex the folder is always a shadow home
   over the same `CODEX_HOME` as the default Codex instance, so the new account can continue
   the same threads; **Change folder** only moves the shadow home (there is no separate
   `CODEX_HOME` option). For Claude, a switch "Share my Claude skills" (on) links the new
   folder's `skills` to the default Claude folder's, like Kyle's `~/.claude_N` accounts.
3. **Create and sign in** creates the folder (never reuses a non-empty one), adds the
   instance, and opens the sign-in flow for it. If sign-in is cancelled the account stays,
   signed out, with a **Sign in** button.

### Remove an account

From the instance editor or Accounts: **Remove account**. Confirmation: "Remove Codex 4 from
this environment? Loom signs it out and stops its running threads. Thread history is kept."
with a checkbox "Also move ~/.codex_4 into Loom's removed accounts folder", shown only for a
folder Loom created and only when no other instance uses it.

### Codex credential storage

Settings > Loom > Accounts shows one row per shared Codex home: "Codex stores logins in
files" with a green check when the shared `config.toml` sets
`cli_auth_credentials_store = "file"` or leaves it unset (Codex's default is `"file"`).
Kyle's machine already has it set, so he sees the check. A shadow-home instance's Account
section shows the same check.

Before a shadow-home sign-in, if the shared `config.toml` sets
`cli_auth_credentials_store` to `"keyring"` or `"auto"`, the account section shows: "This
account uses its own folder, so Codex must store its login in files. Codex is set to use the
system keychain, which all accounts would share." with **Use file storage** and **Sign in
anyway**. **Use file storage** opens a confirmation that shows exactly what changes:

```
~/.codex/config.toml (also used by the Codex command line)
- cli_auth_credentials_store = "keyring"
+ cli_auth_credentials_store = "file"
A copy of the current file is saved first to
<Loom data folder>/fork/provider-sign-in/backups/2026-09-24T10-15-00Z-config.toml
```

with **Change this line** and **Cancel**. Loom changes only that line and nothing else in
the file. If the file changed since the confirmation opened, Loom stops and shows it again.
If Loom cannot edit the line safely (for example the key is written in an unusual form), it
says so and shows the line to set by hand.

### Codex tools

A dialog per Codex instance with tabs **MCP servers** and **Skills**. MCP servers: name,
auth status (signed in, needs sign-in, not required), tools count, and **Sign in** for OAuth
servers (opens the authorization link), plus **Reload configuration**. Skills: every skill
Codex reports with scope (user, repo, system, admin), description and a switch. A change
refreshes the provider snapshot so the composer's `$` menu updates.

### Import from Claude Code

A dialog per Codex instance: **Scan** (home, plus the current project when there is one),
a checklist grouped by type (MCP servers, skills, AGENTS.md, commands, hooks, subagents,
config), and **Import selected**. The result says "Imported 7 items into Codex 2." and
refreshes the provider.

## States

- Loading: "Reading sign-in status." while the first state arrives.
- Idle signed out: "Not signed in." with **Sign in**.
- Idle signed in: "Signed in as <email>" (plus plan label when reported) with **Sign out**.
  **Sign out** asks first: "Sign out of <instance>? Its running threads stop. Thread history
  is kept."
- Starting: "Starting sign-in." Buttons disabled except Cancel.
- Waiting (browser, device code, code paste): as in the flows, always with **Cancel**.
- Verifying: "Checking the account and available models."
- Succeeded: "Signed in as <email>." then idle.
- Failed: the provider's message when safe, else "Sign-in failed. Try again." with **Try
  again**. Timed out: "Sign-in expired after 10 minutes." Cancelled: "Sign-in cancelled."
  Cancelled by a settings change (saving the instance's settings rebuilds it): "Sign-in was
  cancelled because the provider settings changed."
- Another client started the flow: "Sign-in is in progress in another window." with Cancel.
- Disabled instance: "Enable this instance to sign in." with **Enable**.
- CLI missing: "Codex is not installed on this environment." (from the provider snapshot).
- Upstream server: "Account management needs a Loom server." and nothing else.
- Claude API key saved: "An API key is saved for this account." with **Replace key** and
  **Remove key**.
- Claude API key set as a plain variable (typed by hand in the provider form): "An API key is
  set in this instance's environment variables." with **Make it sensitive**, which only moves
  it into the secret store; afterwards the saved-key state applies.
- Custom endpoint Claude instance: the endpoint message above, no buttons.
- Credential storage: green check, warning with **Use file storage**, or "Loom could not
  read ~/.codex/config.toml." (no action offered).
- Read-only settings scope: status only, no buttons.

## Surfaces and connection modes

Web and desktop are supported. Mobile is not (it keeps upstream behavior). Local, Tailscale
and T3 Connect connections all work; the method default and the paste box exist for the
remote cases. Against an upstream T3 server the section explains itself and hides actions.
Against a Loom server, an upstream client sees the decorated snapshot: an "Open provider
setup" button and a message that also names the terminal command, so it is never worse off
than upstream.

## Decisions

- Codex sign-in uses `codex app-server` (`account/login/start`, `account/login/cancel`,
  `account/logout`), not the `codex login` CLI: the app-server reports completion as a
  notification and supports device code and API key in one protocol. Old Loom proved it.
- Claude sign-in drives `claude auth login` because Claude Code has no login API. Old Loom
  used the same approach.
- Sign-in state is server-side and streamed, so two clients see the same flow and a reload
  does not lose it.
- The default account folder name follows Kyle's pattern: `~/.codex_<n>` and
  `~/.claude_<n>` with the next free number.
- "Add account" offers shadow homes only for Codex; **Change folder** stays as the advanced
  option for exceptions and still makes a shadow home. No separate-`CODEX_HOME` option
  (Kyle: shared threads across accounts matter more).
- Claude API keys are instance environment variables marked Sensitive, upstream's mechanism
  (the same way `~/.claude_api` works today). The value is never shown after save; the form
  offers Replace and Remove only.
- Loom may write `cli_auth_credentials_store = "file"` into the shared `~/.codex/config.toml`
  after a confirmation showing the exact line, with a timestamped backup first, changing only
  that key and leaving the rest of the file byte for byte. Loom edits the line itself rather
  than through Codex's config writer, so "only that line" is guaranteed.
- Claude instances that set `ANTHROPIC_BASE_URL` are custom-endpoint instances and get no
  sign-in.
- Removal never deletes files.
