# L18: Project profiles and env panel

Status: Not started.

Per-project knowledge that T3 Code's project settings do not cover, plus a view of the
project's environment variables. A **project profile** holds private agent notes (preferences
you cannot or do not want to commit to the repository), which project action is the project's
test, build, typecheck, lint or dev command, advisory token budgets, and optional bindings to
other Loom features. Agents read it through one MCP tool. The **Env panel** reads the
project's `.env.schema` (the varlock / env-spec format) and shows each variable's type,
whether it is required and sensitive, and whether it is set, never its value. When varlock is
installed, project commands can be launched through `varlock run` from the panel.

## Scope

- In:
  - Profile per project and environment, edited in the Loom settings page (project scope),
    stored in a fork table: agent notes, command intents mapped to upstream project actions,
    daily and per-thread token budgets, env schema path, varlock preference, generic bindings.
  - Budget tracking from existing token-usage activities (Claude and Codex report them),
    with a timeline marker when a budget is crossed. Advisory only.
  - Env panel (right panel, letter E): variables from `.env.schema`, their decorators, and
    presence status per key from the checkout's `.env*` files and the server environment,
    computed on the server. Values never leave the server.
  - "Validate with varlock" on demand (errors only) and "Run with varlock" for the project's
    actions, in the thread's terminal.
  - MCP tool `loom_project_profiles_get` (notes, commands by intent, env variable names and
    status).
  - Command palette entries.
- Out:
  - Anything upstream already owns: default model and effort, runtime mode, thread env mode,
    the project actions (scripts) themselves and `t3.json`, agent browser and device access,
    text generation and writing style, merge method, auto pull. The profile links to
    upstream's Project settings for those.
  - Editing `.env` values, secret storage, or showing values (even redacted).
  - Enforcing budgets (stopping turns); that needs an orchestration seam.
  - Following `@import` of schemas outside the checkout, varlock plugins and secret-manager
    resolution (only through an explicit varlock run).
  - Snippet and skill picker UIs; L01 and L21 register binding sources if present.
  - Old Loom's unused profile fields (safety, workflows, Apple, remote runtime, Apollo, facts,
    retention).
  - Mobile UI.

## Surfaces

Web and desktop: supported. Mobile: not supported (nothing shown; the RPCs are reachable
through client-runtime). Remote: works over every connection mode; env files and varlock live
on the environment's machine. Upstream T3 server: panel entry disabled with "Needs a Loom
server", settings section shows the same.

## Extension points used

[`ext-core`](../EXTENSION-POINTS.md#1-server-core-ext-core) (RPC, ForkLayer, persistence, reactor, capability `"project-profiles"`),
[`ext-panels`](../EXTENSION-POINTS.md#6-right-panels-ext-panels), [`ext-settings`](../EXTENSION-POINTS.md#7-settings-ext-settings), [`ext-palette`](../EXTENSION-POINTS.md#8-command-palette-ext-palette), [`ext-mcp`](../EXTENSION-POINTS.md#10-agent-facing-mcp-tools-ext-mcp). Create any that are missing.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Dependencies needing approval

`@env-spec/parser@0.6.0` (MIT, zero runtime dependencies) in `apps/server`, for parsing
`.env.schema` and `.env` files. A new production dependency needs Kyle's approval before
implementation (CONVENTIONS.md, lockfile rule). TECHNICAL describes the fallback if declined.

## Optional integrations

- If L01 (snippets) or L21 (skill registry) is present, it may register a binding source so
  the profile's Bindings section can pick its items, and may read the profile's bindings to
  rank bound items first. L18 works without either.
- If L26 (code graph) is present: no integration in v1.

## Size

Medium to large: about 2,500 to 3,000 lines including tests.

## How an agent starts

Read AGENTS.md, FORK.md, the packets README, CONVENTIONS.md and EXTENSION-POINTS.md, then this
folder. Confirm the parser dependency with Kyle. Start with the pure pieces (schema reading,
presence computation, budget delta math) and their tests, then storage, service, RPC, UI.

## Documents

[PRODUCT.md](./PRODUCT.md), [TECHNICAL.md](./TECHNICAL.md), [SEAMS.md](./SEAMS.md),
[IMPLEMENTATION.md](./IMPLEMENTATION.md), [TESTING.md](./TESTING.md),
[REFERENCES.md](./REFERENCES.md).
