# L106 product

## Problem and proposed outcome

An agent may need to fetch a statement, manage an appointment or complete another personal account task. Kyle should approve what happens, on which account and site, and for how long, without handing the development server a password-manager unlock.

Proposed first slice: one synthetic adapter with a truly enforced operation allowlist, such as retrieving one fixture statement. A native personal client shows the resolved account, exact HTTPS origin, task, operation parameters, recipient of the result and deadline. Approval permits that operation only. A request, profile, session name or opaque handle grants nothing.

## Two distinct choices

- **Approve outcome:** the trusted adapter performs a typed operation. Any read-only promise must be enforced by the upstream token/API and adapter, including all reachable network routes. Results can contain approved account data, but never authentication material or unrestricted response bodies.
- **Lend session:** show the authenticated site's actual powers and account data exposed to the agent. Arbitrary sites do not offer a reliable read-only browser mode. Navigation, evaluate, page scripts and hidden endpoints may perform writes or reveal authentication material. An agent-readable page filled with a password exposes that password, even if the field is masked or a snapshot omits it. Such fill is prohibited. Session lending stays unsupported unless a disposable, appropriately bounded session and a separate execution boundary can be demonstrated.

## Entry points and lifecycle

Personal Vault's pending requests, an approved task's agent tool result and discoverable palette actions lead to the same request. The independently trusted client alone can approve; the agent can inspect its own request, cancel it and release its handle. Show pending, denied, active, expired, revoked, closing, cleanup-failed and unknown-outcome states with last confirmed timestamps. Lock, disconnect and an absent adapter fail closed for new operations. Closing an inspector does not imply revocation; provide both actions.

Revocation stops future adapter operations. A completed site action cannot be undone by deleting a handle. Close isolated session storage and request upstream session/token invalidation when supported; report separately whether local cleanup and upstream revocation succeeded. A crash leaves a visible cleanup obligation. Unknown writes require receipt lookup or human reconciliation before retry.

## Surfaces, providers and connections

Mac and iPhone approvals with Safari/Chromium checks are provisional first acceptance, not a confirmed platform choice. Native custody must be isolated from full-access agents: a separate trusted device or demonstrated OS account/process boundary, not a UI role, browser profile or safeStorage label. A Mac running same-user unrestricted agents is not automatically trusted.

Codex, Claude, Cursor, Grok, OpenCode, Antigravity and other provider instances use the common service/MCP path where supported; none gets a secret-shaped fallback. Scheduled agent runs use the same gates and require a live valid authorization or return blocked. Command-only jobs remain unsupported until an explicit broker exists. Local, direct remote, relay and tunnel requests bind the destination environment and authenticated run; they do not move custody there. Android/Windows/Linux/web show request status only where safe, otherwise unavailable. Upstream/older servers hide the action or explain the missing capability.

## Decisions still open

Kyle has authorized local personal-Vault work, not selected these detailed scopes. Choose the first useful personal site/task, approval duration ceilings, result data policy and whether any session-lending case is acceptable. Retain broad site support as future adapter work. Independent security review is required before critical personal custody; synthetic local prototyping can proceed now.
