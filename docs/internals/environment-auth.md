# Environment authentication

The environment issues its own sessions and enforces their capabilities. Cloud
identity and relay credentials belong to a separate trust boundary, described in
[T3 Connect](./t3-connect.md). A relay token is never an environment login.

## Authority survives transport changes

Pairing delegates a set of scopes. Exchanging a bootstrap credential can narrow
that grant but cannot widen it. The default grant includes access and relay
management: `terminal:operate` is a shell as the server's user and
`orchestration:operate` can start a full-access agent, and either can mint a
session with every scope through `t3 auth session issue`, so withholding
management from the default would not be a boundary. A narrower client gets
explicit scopes. Creating another pairing link requires both `access:write` and
every scope being delegated. The
[auth handlers](../../apps/server/src/auth/http.ts) enforce this at issuance;
client labels and device metadata have no authorization role.

The access read model contains pairing metadata, never recoverable pairing
secrets. Only the creation response returns the raw credential. Otherwise read
access to the connections list would become a way to acquire another client's
authority.

Browser cookies, bearer tokens, and DPoP tokens adapt the same scoped session
model. DPoP binds a token to a client's proof key; an invalid proof must fail
rather than fall back to bearer authentication. The OAuth token-exchange
vocabulary gives these grants a familiar meaning.

### Identity remains a host-local grant

<!-- fork: identity-renewal -->

[Identity verification](../../apps/server/src/auth/PocketId.ts) accepts only the issuer,
audience, clients and immutable subjects enrolled through the host's trusted process
configuration or private host configuration explicitly saved by its own settings administrator.
Reach's **Use these values** writes a 0600 host file and restarts the backend; process
environment variables take precedence. The Library's issuer or directory never delegates access to another
computer. Each execution host needs its own explicitly accepted API resource; reusing a
Library audience silently widens the trust boundary. Sessions are bounded by the accepted
token's expiry, one hour and, when the host sets `LOOM_IDENTITY_MAX_SESSION_AGE`, that age
counted from the ID token's `auth_time`. Refreshes never move `auth_time`, so it is the only
limit a refresh grant cannot extend. Native clients ask for `offline_access` only from a host
that publishes this limit, and such a host refuses the `/oauth/token` exchange because it
carries no ID token. There is no default limit, because it would lock out clients that predate
the ID-token exchange. Changes to the enrolled policy invalidate previous sessions after
restart; a policy key added later counts only when set, so upgrading keeps them. IdP account
removal alone is not immediate host-session revocation. Revoking the local session closes that
window: revocation follows renewal links, and the session endpoint refuses a renewal that
presents a revoked session. A stolen refresh grant used without a session still mints one
until it is ended at Pocket ID or its subject leaves the allowed list.

<!-- fork: identity-renewal -->

<!-- fork: reach -->

With reach, the Library derives each computer's resource as
`<Library origin>/computers/<environment id>` and creates it at Pocket ID only during a reach
setup. Every sign-in refuses metadata naming another computer's per-computer resource, so a
computer cannot obtain a token for a sibling by naming the sibling's resource in its own
`/api/loom/identity`. The rule is stateless, with no saved pin
([identityResourceRefusal](../../packages/shared/src/fork/identityGrant.ts)): a resource, or an
audience when there is none, refuses when it is an https `/computers/<id>` URL for another
environment. Trailing slashes are ignored because Pocket ID trims them before its exact,
case-sensitive lookup, so they are a stored resource's only aliases. Shared audiences pass, which
lets a computer move to its own resource and back without stranding saved connections, and a
hand-made per-computer resource of another shape counts as shared. Native clients enforce it
because the device holds the token; in a browser the computer's own login page runs the exchange,
so the check, like the issuer check, binds only a computer that reports honestly. A native first
sign-in to a typed address checks the environment id the computer claims against the device's
Library directory (`identityAddressRefusal` in `packages/shared/src/fork/identityGrant.ts`): when
the directory knows that id at other addresses, the sign-in is refused, so an address cannot borrow
a listed computer's or the Library's identity. An id the directory does not know passes.

The Pocket ID admin key that creates resources can also rewrite the native client's callback
URLs, so a leaked key plus one click by the account owner on a genuine sign-in link yields a
sign-in to any computer. `LOOM_IDENTITY_REQUIRE_PASSKEY=true` (exactly `true`; any other
non-empty value stops Identity from starting) refuses the `/oauth/token` exchange and rotates
sessions once when set. The browser callback checks `amr` for `phr` after verifying the ID token.
Native sessions, first and at every renewal, need an ID token bound to the access token by
`at_hash` whenever a passkey or maximum age is required, then check `amr` and the age cap. The
passkey rule is a speed bump against an admin-key holder, who can enroll a passkey. When Pocket ID
refuses a refresh with `invalid_target` (Retire deleted the resource) or `access_denied`, the
client asks for a new sign-in instead of retrying.

<!-- fork: reach -->

A hosted frontend receives a short-lived, single-use PKCE code through an exactly bound
opener message, then redeems it at the selected host without cookies. The host's OIDC
callback stays on the host, and the application handoff never puts credentials in URLs.
Saved connections pin the environment and Identity account. Native clients hold one
refresh grant per computer, because a Pocket ID refresh keeps its original audience, and
renew before each session ends by presenting the current session; the host records the new
session as its successor and open sockets carry over to it. A renewal may use any address of
the saved connection, since the reply must name the same environment and account. Browsers
never see IdP tokens and still sign in interactively. T3 Connect's Clerk relay remains a
separate adapter. Cookie logout requires the configured host origin and clears its HttpOnly
session cookie; bearer logout, like any revocation, ends every session in the renewal chain,
and removing a connection also ends the device's grant at Pocket ID.

### Guest links are not sessions

A [guest link](../user/guest-links.md) gives one browser read access to one
thread and a way to propose messages. Its tokens are HMACs of the thread and
share id under a server key ([GuestShareService](../../apps/server/src/guest/GuestShareService.ts)),
so nothing secret is stored. The share in the thread projection is the only
state: replacing, closing, or archiving it revokes every token, and the
orchestrator's serial commands make redeeming and sending happen once. Guest
tokens never enter `SessionStore`, so no RPC, WebSocket, or MCP path can accept
one. Guest routes also require T3 Connect to still serve the link's hostname;
the request's Host header is not checked, because a LAN client can forge it.

### MCP clients are a separate audience

Agents T3 Code did not launch sign in to `/mcp` through a narrow OAuth
authorization-code server ([McpOAuth](../../apps/server/src/auth/McpOAuth.ts)).
It accepts loopback redirect URIs for agents on the user's machine and any
HTTPS redirect for hosted agents (ChatGPT, bots). An HTTPS redirect means a
link someone else sends the owner can deliver access to that someone, so the
approval page names the host access goes to and approving stays the owner's
call. Every client is public and proves itself with PKCE; a client that asks
for a secret is registered without one. Client registration is stateless, so an unauthenticated caller cannot grow server
state. Approval spends a one-time pairing code, or uses a browser session with
`access:write`; proof-bound T3 Connect codes are refused without being spent.

The user grants either read-only access or a runtime-mode ceiling, not a
scope list: MCP tools are all orchestration, and `orchestration:operate`
alone would let an agent start a thread in full access and act through it.
The result is an ordinary session with subject `mcp-client`. A read-only
grant holds `orchestration:read` alone. On `/mcp` it passes only tools
declared as reads in [McpToolAccess](../../apps/server/src/mcp/McpToolAccess.ts),
where every tool must declare who may call it to compile. Any other grant adds
`orchestration:operate` and a signed ceiling. Only `/mcp` accepts these sessions. Every other HTTP and WebSocket
path rejects that subject, because the RPC surface would let the agent act
above its ceiling. Inside MCP the credential sets the limits and tool
parameters only pick targets; see
[threadAccess](../../apps/server/src/mcp/threadAccess.ts).

<!-- fork: reach -->

A reach address never forwards `/mcp`, `/oauth/mcp/*` or `/.well-known/oauth-*`. None is on
the reach allowlist, so outside agents reach MCP only through the computer's other addresses,
and the approval page above is never served to the internet.

<!-- fork: reach -->

Issuer and resource URLs come from the request's Host and
`X-Forwarded-Proto`, so one server answers over loopback, Tailscale Serve and a
T3 Connect tunnel. A proxy that rewrites Host or drops the protocol header
breaks sign-in. The same header marks browser session cookies `Secure`,
because a proxy may also answer plain HTTP for that hostname and would leak an
unmarked cookie there. A browser will not replace a `Secure` cookie from plain
HTTP, so after signing in over HTTPS, the same server reached over plain HTTP
on that hostname stays signed out until the cookie expires or is cleared.

Bearer and DPoP clients obtain short-lived WebSocket tickets through authenticated
HTTP so long-lived tokens stay out of socket URLs. A ticket names the route it
opens: the RPC socket, or the media routes (device hub, preview stream), which
share one ticket across `<img>`, `EventSource` and several sockets. A DPoP
client's RPC ticket is bound to its proof key and the upgrade carries a fresh
proof in the `dpop` query parameter, since a WebSocket cannot set headers; a
ticket captured on a plain HTTP LAN route is useless without the key, and the
proof's `jti` is consumed like any other. Media tickets stay bearer because each
media request would need its own proof. Clients that predate this mint unbound
tickets that open either route. Browser sessions can authenticate the upgrade
with their cookie. A successful handshake grants no
extra authority: [every RPC declares a required
scope](../../apps/server/src/auth/RpcAuthorization.ts), and the WebSocket RPC
group's `RpcScopeAuthorization` middleware checks it before any handler runs.

Scope changes must not prevent older clients from connecting. Token exchange
intersects recognized requests with the pairing grant; retired and unknown names
are dropped. A request with no granted scopes fails before consuming the link.
Stored credentials are never expanded when scopes split.

Auth responses keep `scopes` within the original wire vocabulary and include
`permissions` for the exact grant. New clients use `permissions` when present,
even if empty. Older servers omit it, so clients use legacy parent checks for
features those servers already support. These client checks never change server
authorization. Permission errors likewise retain a legacy `requiredScope` and
add the exact `requiredPermission`, so a denied RPC stays decodable by old clients.
Unknown response permissions are ignored; grant inputs stay strict.

Desktop restarts forget the previous local bearer token, so its reusable
bootstrap grant replaces earlier sessions for the same subject and method.
Revocation and insertion share a [database
transaction](../../apps/server/src/persistence/AuthSessions.ts); a failed
replacement must leave the old credential usable. Pairing and browser sessions
do not follow this replacement rule.

<!-- fork: reach -->

### Reach addresses expose an allowlist

A reach address puts a computer on the internet, so only an explicit list of methods and paths
answers there ([reach.ts](../../packages/shared/src/fork/reach.ts)). Two layers apply it from
that one constant: a Cloudflare WAF rule the Library maintains, and an in-process
[guard](../../apps/server/src/fork/reach/guard.ts) on the computer. The edge follows the
Library's version and the guard follows the computer's, so a path added to the list answers only
once both run the new version. A new route stays unreachable over reach until it is listed, and
listing it exposes it to the internet, so it must authenticate.

Every request that acts on the computer needs a credential. The unauthenticated surface is
`/.well-known/t3/environment`, `GET /api/loom/identity`, `GET /api/auth/session`, the
pairing-code exchange at `POST /oauth/token`, and signed asset and preview URLs, which are
bearer URLs. The guard accepts only pairing codes at `/oauth/token`, never a desktop bootstrap
or the dev credential. It also refuses `X-Forwarded-Host`, dot segments and encoded separators,
answers 404 while reach is off, and strips every `Set-Cookie`, so no browser cookie session is
ever set on a reach address. Webhooks and browser Identity sign-in stay blocked there.

<!-- fork: reach -->

### Reusable dev credential

Web development environments can accept one `T3CODE_DEV_AUTH_TOKEN` across
worktrees and ports on one hostname. The token and startup URLs that contain it
grant administrative access. Desktop and non-development servers ignore it. See
the [development runbook](../operations/development.md#reusable-dev-credential)
for setup.

Each environment hashes the value and seeds its own database record at startup.
Environments do not share SQLite data, signing keys, environment IDs, session
records, pairing grants, or revocation state. Local revocation persists after
restart and does not affect another worktree. Removing or rotating the value
and restarting invalidates the old credential and its WebSocket tickets.

Normal credentials keep precedence. A rejected normal credential never falls
back to the reusable credential. OAuth exchanges create ordinary local bearer
or DPoP children with normal expiry and revocation. The reusable cookie expires
after 30 days.

## The environment is the filesystem boundary

Projects are organizational boundaries, not filesystem sandboxes.
`filesystem:read` permits reading files the server account can read, including
absolute paths outside a project. This lets clients display artifacts that an
agent writes in a temporary directory. Relative paths and writes still follow
the [workspace path rules](../../apps/server/src/workspace/WorkspaceFileSystem.ts).

Signed asset URLs are bearer credentials. A URL for media on the host grants
access to one canonical file and its device/inode identity, not its containing directory.
[Asset access](../../apps/server/src/assets/AssetAccess.ts) rechecks the opened
file's identity when serving it, so atomic replacement requires a new URL while
editing the same file in place does not. An HTML file authorized this way cannot
load sibling assets; directory-scoped workspace previews are a separate grant.
Clients should share the authored file reference so they do not disclose the
temporary URL's credential. `filesystem:read` is checked when the URL is minted,
not when it is served: a URL issued before the grant was revoked keeps working
until it expires, and it is not bound to the session that minted it.

Host videos can change in place. Their [HTTP
responses](../../apps/server/src/http.ts) omit cache validators because file
metadata cannot prove byte-for-byte identity for `If-Range`. Adding weak
validators would turn native-player seeks into full downloads.
