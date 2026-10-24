# Loom-owned connections: replacing T3 Connect

Status: **In progress** (C01 and C02 done, C03 next). Kyle chose this direction on 2026-10-24: Loom Identity and
the Library replace the T3 Connect account, the phone reaches computers from anywhere without
Tailscale, and push notifications get their infrastructure now but are switched on last, after
Kyle decides. Connect is turned off in Loom builds only after C01 to C03 work on desktop and
iPhone.

## Why

Connect is the stock way to use T3 Code on a phone. Loom's builds use T3's hosted relay
(`relay.t3.codes`) and T3's Clerk account, so the computer list and every phone sign-in go
through a third party. Loom already has the pieces to own this: Identity (Pocket ID at
`id.loom.begam.in`), the Library directory where each computer reports a signed descriptor with
its routes, and Cloudflare tunnels on Kyle's own account for preview links.

What Connect provides today, and what replaces each part:

| Connect provides                                  | Loom replacement                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| One account sign-in lists every computer          | Sign in to the Library once; the directory lists computers (C02)      |
| Managed endpoints reach computers behind NAT      | A Cloudflare tunnel per computer on Kyle's account (C03)              |
| Short-lived credentials that renew without asking | Identity refresh tokens on native clients (C01)                       |
| APNs and FCM pushes, Live Activities              | Library-side device registry and APNs sender, off until enabled (C04) |

T3's relay signs pushes with T3's Apple key, while the Loom iPhone app has its own app ID, so
pushes to the Loom app very likely do not arrive today. C04 should confirm this first.

## Shared design

- **One grant per computer, renewed silently.** A Pocket ID refresh keeps the audience it was
  issued for, and every computer keeps its own audience (see
  [environment-auth](../../internals/environment-auth.md)), so a native client holds one
  refresh grant per account and computer, in platform secret storage (desktop `safeStorage`,
  iOS Keychain). Connecting a computer takes one short browser authorization, which completes
  on its own while the Pocket ID browser session is fresh. Before each hour-long computer
  session ends, the client refreshes the grant and exchanges the new tokens at the computer;
  the open socket carries over to the new session. Pocket ID rotates refresh tokens and
  revokes a grant whose old token is reused, so refreshes are single-flight per grant.
- **The sign-in limit lives on the computer.** Pocket ID's refresh lifetime slides with use,
  so it cannot cap a sign-in. The computer reads `auth_time` from the ID token sent with each
  exchange and refuses sessions past `LOOM_IDENTITY_MAX_SESSION_AGE`.
- **The directory is the computer list.** Clients read computers and routes from the Library
  directory. Routes come from the signed descriptor, so a client never trusts a route the
  computer did not publish.
- **Reach is a public route behind Identity.** A computer that opts in runs `cloudflared` as a
  child of its server (the preview-links supervisor pattern) and publishes the tunnel hostname
  as a `public` route. The server still requires an Identity or paired credential for every
  request. Pairing remains the fallback for clients without Identity.
- **Upstream code stays.** Turning Connect off means not publishing its Clerk and relay
  config in Loom releases. Upstream already hides Connect surfaces when that config is absent,
  so no upstream Connect code is deleted and merges stay easy. Computers linked earlier keep
  their relay secrets and keep running T3's tunnel and activity publishing, so C05 also unlinks
  them and clears that state.

## Packets

| ID  | Packet                                     | Status   | Scope                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | L112 Identity renewal                      | Done     | Desktop and iPhone keep a refresh grant per computer and renew each computer session before it expires, with the socket carried over. Computers cap sign-ins by `auth_time`. Removing a connection ends the grant. Browser clients keep manual sign-in, with the expiry notice from 5edf279f1d.                  |
| C02 | L113 Library computer list on every client | Done     | After one Library sign-in, desktop, web and iPhone list directory computers that are not yet connected and connect each one with the same Identity, without pairing codes. Sign-ins are pinned to the Library's issuer. The list lives in Connections settings only, not the command palette or settings search. |
| C03 | L114 Reach from anywhere                   | Selected | Per-computer Cloudflare tunnel on Kyle's account at `<computer>-loom.begam.in`, provisioned from the Library with a Library-held Cloudflare token, supervised by the computer's server and published as a directory route. Includes turning reach off and removing the tunnel.                                   |
| C04 | L115 Push infrastructure                   | Selected | Library device registry and APNs sender with Kyle's team key, behind an off switch. The iPhone registers with the Library only when enabled. Integration waits for Kyle.                                                                                                                                         |
| C05 | L116 Connect off in Loom builds            | Selected | Stop publishing Clerk and relay config, unlink computers and clear their relay state, turn off telemetry to T3, verify every Connect surface hides cleanly on desktop, web and iPhone, and retire the Connect-only `fleet-connect` seams and help text.                                                          |

## Decisions

- **Route domain (2026-10-24).** Computer hostnames are `<computer>-loom.begam.in`, one level
  under `begam.in` so Cloudflare's free Universal SSL certificate covers them. `bagels.top`
  stays reserved for preview pages.
- **Telemetry (2026-10-24).** Loom builds send no product telemetry to T3; it stays available
  through `T3CODE_TELEMETRY_ENABLED=true`. Product analytics default off already
  (`fork: telemetry-off`). Relay tracing needs relay credentials baked into the build, so it
  leaves with the relay config in C05.
- **Sign-in lifetime (2026-10-24).** 30 days with Cloudflare Access in front of computer
  routes, 7 days without it, enforced by each computer's maximum sign-in age.
- **Exposure policy (2026-10-24).** Kyle chose more security over the lightest setup, in two
  steps. First, computer routes ship with edge hardening: only the paths a Loom client needs
  are forwarded, with rate limits, and the computer's server still requires Identity. Second,
  Cloudflare Access goes in front with Pocket ID as its identity provider, so a passkey
  sign-in admits the device and unauthenticated traffic never reaches Loom. Step two waits
  until Cloudflare's native-app token flow is verified on desktop and iPhone, including
  WebSockets. If Access cannot work cleanly, routes stay on step one and the refresh token
  lifetime stays at 7 days.
- **Pocket ID resources (2026-10-24).** The Library holds a Pocket ID admin API key and creates
  one API resource per computer, granted to the native client. Computers can refuse Identity
  sessions whose ID token `amr` lacks a passkey (`phr`). That is a speed bump, not a wall: the
  key has full admin rights, so its holder can enroll a passkey or rewrite the native client's
  callback URLs, and one click by the account owner on a genuine authorize link then yields a
  passkey sign-in to any computer. Keep the key off the Library except while provisioning, and
  rotate it in Pocket ID on any suspected leak.
- **Identity stays the computer's setting.** The Library provisions the Pocket ID resource
  and hands back its values; the computer's own admin turns Loom Identity on, as
  [environment-auth](../../internals/environment-auth.md) requires.

- **C01 rollout (2026-10-24).** Renewal starts only on a computer that sets
  `LOOM_IDENTITY_MAX_SESSION_AGE`, and clients older than C01 cannot sign in once it is set, so
  update the desktop and iPhone apps first, then raise the native client's refresh lifetime,
  then set `7d` on the Library and each computer. The Library runs 0.0.119 since 2026-10-24
  (loom-platform pin `08094b9`). The native refresh change is on loom-platform branch
  `identity/native-refresh-7d` and waits for the admin-key apply. Clients take the issuer and
  the grant's `resource` from the computer they sign in to. C02 pins directory computers to the
  Library's issuer, and C03 records each computer's Pocket ID resource in the Library. In the
  browser, the computer's own login page picks the provider, so the pin stops only a computer
  that reports its provider honestly; browsers keep no refresh grant.

## C03 constraints

Found while researching the Cloudflare and Pocket ID APIs; each one changes the build.

- `cloudflared` ingress path rules are unanchored regexes on the raw path, so they cannot be an
  allowlist. The allowlist is one zone WAF custom rule that blocks
  `ends_with(http.host, "-loom.begam.in")` requests outside the client path prefixes. The free
  plan allows 5 custom rules without regex and one rate limit rule (path match, per IP, 10
  second window), so the Library manages both once for the zone. `/mcp` stays off the list.
- The Library's Cloudflare token needs Account Cloudflare Tunnel Write and, on `begam.in`, Zone
  DNS Write, Zone WAF Write and Zone Read. The account ID comes from `GET /zones?name=begam.in`.
- A computer's port can change across restarts, so turning reach on is an idempotent ensure
  that runs on every start and updates the tunnel's ingress.
- Removal order matters: stop the `cloudflared` child, clear the tunnel's connections, delete
  the tunnel, then delete the CNAME. Cloudflare refuses to delete a tunnel with live
  connectors.
- Pocket ID `PUT` on an OIDC client replaces the whole client, so provisioning only creates
  API resources and grants (`POST /api/apis`, `PUT /api/apis/{id}/clients/{clientId}`). A 409
  means the resource exists and is found by search. Each authorization carries exactly one
  resource.
- Native renewal needs the `loom-library-native` client's refresh lifetime raised from 60
  minutes to 7 days (10080) through the identity reconciler in loom-platform.
- Access step two needs a live test before any build work: Managed OAuth is Cloudflare's only
  per-user native flow, and the test must cover WebSocket upgrades, its header against Loom's
  `Authorization`, a 720 hour grant and one app reused across the wildcard hostnames.
