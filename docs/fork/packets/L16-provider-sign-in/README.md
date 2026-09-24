# L16: In-app provider sign-in and setup

Status: Ready to build.

Sign Codex and Claude accounts in and out from inside Loom, add a second or third account of
the same provider without a terminal, and manage Codex's tools (MCP servers, skills) and a
one-shot import of Claude Code configuration into Codex. Every action targets one provider
instance, so it lands in that instance's own home: the Codex shadow home for a second Codex
account, the instance's `CLAUDE_CONFIG_DIR` for a second Claude account. It works the same
from a phone or another computer connected to the environment, because the sign-in runs on
the environment's machine and the client only shows the link, the device code or a paste
box.

Upstream T3 Code only has in-app sign-in for Antigravity. For Codex it says "Run `codex
login`" (`apps/server/src/provider/Layers/CodexProvider.ts:554`), and for Claude it asks for
`claude auth login` on the environment's machine (`apps/server/src/provider/Drivers/ClaudeHome.ts:58-70`).

## Scope

- In:
  - Codex sign-in per instance with three methods: ChatGPT in the browser, ChatGPT device
    code, and OpenAI API key, driven through `codex app-server`'s `account/login/*` methods.
    Sign out.
  - Claude sign-in per instance through `claude auth login` (Claude subscription, or Anthropic
    Console with `--console`), with the authorization link shown in the app and a box for the
    code Claude shows. Sign out through `claude auth logout`. API key as a sensitive
    environment variable on the instance (upstream's secret store); never shown after save,
    with only Replace and Remove offered.
  - Remote sign-in: device code for Codex; "paste the final localhost URL" for Codex browser
    sign-in and Claude, forwarded to the environment's loopback listener.
  - Add account: create the next account folder (`~/.codex_<n>` as a shadow home over the
    shared `~/.codex`, or `~/.claude_<n>` as a `CLAUDE_CONFIG_DIR`), add the provider
    instance, then open sign-in for it. Codex accounts are always shadow homes; an advanced
    **Change folder** picks another location for the shadow home. Remove account: sign out,
    remove the instance, and optionally move a Loom-created folder aside.
  - Codex credential storage check: a shadow-home account needs file credentials. Shows a
    green check when the shared `config.toml` already uses file storage (Kyle's machine
    does). Otherwise Loom offers to set `cli_auth_credentials_store = "file"` itself, after a
    confirmation that shows the exact line, with a timestamped backup first, changing only
    that key.
  - "Same account as ..." warning when two instances of one provider report the same email.
  - Codex tools page per Codex instance: MCP servers with auth and tool status, reload MCP
    configuration, start an MCP server's OAuth sign-in, and enable or disable Codex skills.
  - Import Claude Code configuration into a Codex instance through Codex's own
    `externalAgentConfig/detect` and `externalAgentConfig/import`.
- Out:
  - Sign-in for Cursor, Grok and OpenCode (they manage their own logins; upstream's messages
    stay). Antigravity keeps upstream's flow.
  - Sign-in for L17's Copilot and custom ACP agent drivers, Gemini CLI among them (their CLIs
    own login; L17 may register its own setup section later).
  - Account usage meters and reset credits (upstream already shows usage limits).
  - A cross-provider skill registry (L21). This packet only toggles Codex skills.
  - Continuous sync of Claude configuration into Codex; import is one-shot.
  - Deleting account folders. Removal moves a Loom-created folder into Loom's state
    directory; nothing is deleted.
  - A separate `CODEX_HOME` per Codex account (no shared threads). Kyle chose shadow homes
    only; not planned.
  - Showing or copying a saved Claude API key. Upstream keeps sensitive values in its
    secret store and never sends them to clients; the form offers Replace and Remove.

## Surfaces

- Web and desktop: supported. The sign-in section lives in **Settings > Providers**, inside
  each Codex and Claude instance's editor. Desktop opens links with the system browser.
- Mobile: not supported in this packet. The upstream mobile app keeps showing upstream's
  messages; the in-app flow is reachable from web or desktop against the same environment.
- Remote: supported over direct, Tailscale and T3 Connect connections. Every action is a fork
  RPC on the environment's WebSocket. Nothing reads the client's filesystem or credentials.
- Upstream T3 server: the section shows "Account management needs a Loom server." and nothing
  else changes.

## Extension points used

- [`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC group, server layer, capability `provider-sign-in`, fork storage).
- `ext-providers` ([EXTENSION-POINTS.md, section 15](../EXTENSION-POINTS.md#15-provider-drivers-ext-providers)): a driver decorator for Codex and Claude, and a setup section in
  the provider editor.
- [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings): an "Accounts" section on the Loom settings page (add account, list of
  accounts per provider with status).
- [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette): "Sign in to <instance>", "Add Codex account", "Add Claude account", "Open Codex tools".

## Packet seams

None. Every upstream touch goes through `ext-core`, `ext-providers`, `ext-settings` and
`ext-palette`. See [SEAMS.md](./SEAMS.md).

## Optional integrations

- If L21 (skill registry) is present, both packets toggle Codex skills through the same Codex
  method (`skills/config/write`), so they cannot disagree. Follow-up, not built by this
  packet: a "Manage all skills" link on the Codex tools page's skill list that opens L21's
  panel.
- If L17 is present, its Copilot driver (and its generic ACP agent option) could register
  their own setup sections later; nothing in this packet depends on that. L17's model
  endpoint instances are Claude instances that set `ANTHROPIC_BASE_URL`; this packet treats
  every such instance as a custom-endpoint instance (no sign-in offered, see TECHNICAL.md),
  whether or not L17 created it.

## Size estimate

Medium to large: about 2,800 to 3,600 lines including tests. Server login managers and RPC
handlers about 1,400, contracts 300, client atoms 150, web UI 1,200, tests 600.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md, EXTENSION-POINTS.md, then this
folder in the order PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING, REFERENCES. Run the existence checks for `ext-core`, `ext-providers`, `ext-settings` and
`ext-palette` first. Do not run `codex login`, `claude auth login` or any sign-in against
Kyle's real homes during development; use a scratch `CODEX_HOME` and `CLAUDE_CONFIG_DIR`
under the worktree (TESTING.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
