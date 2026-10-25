# Loom-owned connections: replacing T3 Connect

Status: **In progress** (C01 and C02 done, C03 and C04 built and off, C05 phase 1 landed). Kyle chose this direction on 2026-10-24: Loom Identity and
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

Pushes do not reach the Loom iPhone app today. Loom's release builds never ask iOS for an APNs
token: the release forces upstream push off, so the signed app carries no `aps-environment`
(confirmed on the 0.0.122 nightly IPA). T3's relay would also sign with T3's Apple key, which
APNs refuses for Loom's own app ID.

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
  as a `public` route. Every request that acts on the computer still needs an Identity or
  paired credential; the small unauthenticated surface is listed in
  [environment-auth](../../internals/environment-auth.md). Pairing remains the fallback for
  clients without Identity.
- **Upstream code stays.** Turning Connect off means not publishing its Clerk and relay
  config in Loom releases. Upstream already hides Connect surfaces when that config is absent,
  so no upstream Connect code is deleted and merges stay easy. Computers linked earlier keep
  their relay secrets and keep running T3's tunnel and activity publishing, so Kyle unlinks them
  before the flip, and a server built with Connect retired clears that state at startup and
  refuses new relay links.

## Packets

| ID  | Packet                                     | Status         | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C01 | L112 Identity renewal                      | Done           | Desktop and iPhone keep a refresh grant per computer and renew each computer session before it expires, with the socket carried over. Computers cap sign-ins by `auth_time`. Removing a connection ends the grant. Browser clients keep manual sign-in, with the expiry notice from 5edf279f1d.                                                                                                                                            |
| C02 | L113 Library computer list on every client | Done           | After one Library sign-in, desktop, web and iPhone list directory computers that are not yet connected and connect each one with the same Identity, without pairing codes. Sign-ins are pinned to the Library's issuer. The list lives in Connections settings only, not the command palette or settings search.                                                                                                                           |
| C03 | L114 Reach from anywhere                   | Built, off     | Per-computer Cloudflare tunnel at `<computer>-loom.<zone>`, provisioned from the Library with a Library-held Cloudflare token, supervised by the computer's server and published as a directory route. Includes turning reach off, removing the address and retiring it from the Library. The hosted Library's credential files are installed and passed read-only checks; reach is not verified live ([runbook](../operations/reach.md)). |
| C04 | L115 Push infrastructure                   | Built, off     | Library device registry and APNs sender with Kyle's team key, off at four layers (Library switch, advertised slug, iOS build flag, per-device opt-in). The iPhone registers with the Library only when all four are on. Agent alerts (C04-10) are built behind `LOOM_LIBRARY_PUSH_ACTIVITY`, off by default: computers tell their Library when an agent needs you. Apple setup and a build with the flag on are pending Kyle.              |
| C05 | L116 Connect off in Loom builds            | Phase 1 landed | Stop publishing Clerk and relay config, unlink computers and clear their relay state, turn off telemetry to T3, verify every Connect surface hides cleanly on desktop, web and iPhone, and retire the Connect-only `fleet-connect` seams and help text. Phase 1: the server cleanup behind an explicit retired flag, the relay and mobile tracing strip, and two copy fixes. The rest is the [C05 flip](#c05-flip).                        |

## Decisions

- **Route domain (2026-10-24).** Computer hostnames are `<computer>-loom.<zone>`, one level
  under the zone so Cloudflare's free Universal SSL certificate covers them. The zone was
  `begam.in`; C03 makes it a required setting, `LOOM_REACH_ZONE`, with no default, because a
  token with DNS edit rights on `begam.in` could repoint `id.loom.begam.in`. A dedicated zone,
  ideally in its own Cloudflare account, is the recommended default pending Kyle. `bagels.top`
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
  passkey sign-in to any computer. The key is a dedicated Pocket ID admin API key with a
  one-year expiry, kept in a file on the Library, not Pocket ID's `STATIC_API_KEY`, which the
  identity workload deliberately leaves unbound (D1). Rotate it in Pocket ID on any suspected
  leak; replacing the file needs no restart.
- **Identity stays the computer's setting.** The Library provisions the Pocket ID resource
  and hands back its values; the computer's own admin turns Loom Identity on, as
  [environment-auth](../../internals/environment-auth.md) requires.
- **C03 build (2026-10-24).** Reach is built and ships off. D1 is settled: a dedicated,
  file-based Pocket ID admin key. Its other defaults D2 to D13 (required zone, opt-in passkey
  policy, agents can turn reach off but never on, sticky hostnames) are reversible and wait for
  Kyle; see the [L114 decisions](./L114-reach/README.md#decisions-defaults-pending-kyle).
- **Library reach credentials.** They are files on the hosted Library: the Cloudflare token
  (Account Cloudflare Tunnel Edit; Zone DNS Edit, Zone WAF Edit and Zone Read on the reach zone)
  and the dedicated Pocket ID admin key. Both are installed and passed read-only checks.
  Rotating either one means replacing its file, with no restart. C03 and C04 are not verified
  live.
- **C04 build (2026-10-24).** Library push is built and off at four layers, with a secret-store
  registry and no migration. Agent alerts (C04-10) are built behind
  `LOOM_LIBRARY_PUSH_ACTIVITY`, off. Its defaults K1 to K12 wait for Kyle; see the [L115 decisions](./L115-push/README.md#decisions-defaults-pending-kyle).

- **C01 rollout (2026-10-24).** Renewal starts only on a computer that sets
  `LOOM_IDENTITY_MAX_SESSION_AGE`, and clients older than C01 cannot sign in once it is set, so
  update the desktop and iPhone apps first, then raise the native client's refresh lifetime,
  then set `7d` on the Library and each computer. The Library runs 0.0.119 since 2026-10-24
  (loom-platform pin `08094b9`). The native refresh change is on loom-platform branch
  `identity/native-refresh-7d` and waits for the admin-key apply. C02 pins directory computers
  to the Library's issuer. Since C03, every sign-in also refuses a computer whose metadata names
  another computer's per-computer resource, by a stateless rule with no saved pin (see
  [environment-auth](../../internals/environment-auth.md)). In the browser, the computer's own
  login page picks the provider, so both checks stop only a computer that reports honestly;
  browsers keep no refresh grant.

## C03 constraints

Found while researching the Cloudflare and Pocket ID APIs; each one changes the build.

- `cloudflared` ingress path rules are unanchored regexes on the raw path, so they cannot be an
  allowlist. The allowlist is one zone WAF custom rule that blocks requests to hosts where
  `lower(http.host) contains "-loom.<zone>"` unless the method and path are on an explicit list
  of exact paths and prefixes. The computer's in-process guard applies the same list from the
  same constant. The free plan allows one rate limit rule (path match, per IP and data center,
  10 second window). The Library manages each rule by its `loom-reach:` description and leaves
  every other rule alone. `/mcp` stays off the list.
- The Library's Cloudflare token needs Account Cloudflare Tunnel Write and, on the reach zone,
  Zone DNS Write, Zone WAF Write and Zone Read, with an IP filter for the Library's egress. The
  account ID comes from `GET /zones?name=<zone>`.
- A computer's port can change across restarts, so turning reach on is an idempotent ensure
  that runs on every start and updates the tunnel's ingress. Every ensure also rotates the
  tunnel secret, clears connections and returns a fresh connector token, which the computer
  never stores.
- Removal order matters: stop the `cloudflared` child, rotate the tunnel secret, clear the
  tunnel's connections, delete the tunnel, then delete the CNAME only if it still matches.
  Cloudflare refuses to delete a tunnel with live connectors.
- Pocket ID `PUT` on an OIDC client replaces the whole client, so provisioning only creates
  API resources and grants (`POST /api/apis`, `PUT /api/apis/{id}/clients/{clientId}`). A 409
  means the resource exists and is found by search. Each authorization carries exactly one
  resource.
- Native renewal needs the `loom-library-native` client's refresh lifetime raised from 60
  minutes to 7 days (10080) through the identity reconciler in loom-platform.
- Access step two needs a live test before any build work: Managed OAuth is Cloudflare's only
  per-user native flow, and the test must cover WebSocket upgrades, its header against Loom's
  `Authorization`, a 720 hour grant and one app reused across the wildcard hostnames.

## C05 flip

Phase 1 is safe while Connect is on. The publisher sets `LOOM_CONNECT_RETIRED=1` only when
`connect.json` says `"enabled": false`, and prepared records freeze it with the Connect config.
A missing `connect.json` does not retire, and dev runs, LoomOS custom builds and other builds
without the flag never clean up. The publisher passes the flag to the CLI runtime archive
workflow as its `connect_retired` input, so CLI service hosts and pinned runtimes retire with the
same release. At
startup, before anything reads them, a retired server clears every Connect secret except its key
pair and replay markers and logs one warning. It also refuses new relay links. The flip waits
until C01 to C03 work on desktop and iPhone.

Flip work, built when Kyle schedules the flip and merged in one go:

- **Fork Connect UI (no seams).** Web `ComputerConnectionsHome.tsx` says shared computers come
  from the Library and drops `<ConnectAccount />` and the Connect-only search targets
  (`t3-connect`, `publish-agent-activity`, `hold-webhooks-while-offline`); delete
  `ConnectAccount.tsx`. Drop the Connect account wording from `LoomSignIn.tsx` and iPhone
  `LibraryIdentityScreen.tsx`, and the T3 Connect account button from `LibraryScreens.tsx`.
- **iPhone Connect retirement.** Delete `apps/mobile/src/fork/connect/` and revert the fork
  Connect hunks in `SettingsAuthRouteScreen.tsx`, `SettingsEnvironmentDetailRouteScreen.tsx`,
  mobile `cloud/publicConfig.ts` and `cloud/linkEnvironment.ts` (with their tests) and
  `reactCompilerBailouts.ts`. The same change drops the enabled Connect config check and the
  `fork/connect` tests from `loom-ios-testflight.yml`, so code and workflow roll back together.
  Decide what saved relay computers offer on iPhone: `use-remote-environment-registry.ts` shows
  "Open T3 Account" and `platform.ts` says "Sign in to T3 Connect to connect this environment."
  Remove the action or route it to the Library sign-in.
- **Seams.** Retire `fleet-connect` and `connect-compat`, matching manifest rows by file, not
  row number; `GitHubRoutingSettings.tsx` (`fleet-connections`) stays. The release delivery
  seams in `cliRelease.ts`, ssh `tunnel.ts` and `public-config.ts` (with their tests) and
  `environment-maintenance.test.ts` move unchanged to a new `loom-releases` marker, and
  `environment-maintenance.test.ts` gets the FORK.md row it lacks.
  `ConnectOnboardingRouteScreen.tsx` drops its stale marker and marks `replace("Library")` with
  `library`. The `app.config.ts` Connect line becomes `mobile-identity`; recount, since the file
  already has 3 such lines. Revert web `cloud/publicConfig.ts` to upstream and delete
  `connectAuthSurface.ts` and its test. Markers and manifest change in one commit.
- **Webhook notes.** `packages/client-runtime/src/webhookAddress.ts` and its test drop the "Link
  ... T3 Connect for a public URL" clauses, marked `fork: connect-off`.
- **FORK.md and help.** Rewrite the brand note, the L116 paragraph and the "Shared computer
  connections" intro, and update the L116 `SEAMS.md`. `docs/fork/user/connections.md` replaces
  the Connect account text with the Library and pairing (and reach as far as C03 has shipped);
  `preview-links.md` drops its T3 Connect sentence. Upstream `docs/user` Connect pages stay
  unless Kyle decides otherwise.

Kyle's steps, in order:

1. **Move relay webhook callers.** Scheduled tasks and bot triggers whose address is on the
   relay (`https://<relay>/v1/hooks/...`) stop working once the link clears. Point their
   callers at a direct or C03 address.
2. **Unlink while Connect is on.** On each desktop, signed in to Connect, turn off
   **Settings > Connections > T3 Connect**, which deletes T3's record. On headless hosts run
   `loom connect logout`. Remote computers can also be unlinked from their iPhone details or
   **Manage account > Linked computers**. Nothing in Loom can delete T3's record after the flip.
3. **Sign out of T3 Connect** on desktop, every browser and iPhone. Sign-out removes saved
   relay-only computers, and on iPhone it also tries to unregister agent awareness.
4. **Inventory host binaries.** For every host (desktops, CLI service hosts, SSH remotes,
   LoomOS custom `t3`, the Library), note where its server binary comes from and whether it is
   linked. Builds without the retired flag never clean up, so unlink those by hand. Confirm no
   shell profile or launchd env exports `T3CODE_RELAY_URL`, `T3CODE_CLERK_*` or relay tracing
   values, because runtime env outranks build config.
5. **Check T3's account.** It lists no linked computers and no agent-awareness devices.
6. **Pause the publisher:** `node scripts/fork/updates.ts disable`.
7. **Retire Connect:** set `"enabled": false` in
   `~/Library/Application Support/Loom Updates/connect.json`.
8. **Merge the flip work.**
9. **Resume the publisher:** `node scripts/fork/updates.ts enable`, which also refreshes its
   copied tools.
10. **Publish a newly prepared version.** Records already marked ready replay their old config.
11. **Check the publish.** The record has no Connect config and carries the retired flag, the
    CLI archive run has empty Clerk and relay inputs and the retired input set, and the iOS
    release config check passes.
12. **Update every computer.** One that was linked logs one warning that it cleared its Connect
    link and no "T3 Connect managed tunnel" lines after it. No relay `cloudflared` from the old
    link keeps running; C03's connector is separate.
13. **Real-client pass.** Desktop and web: Connections has no T3 Connect or account row and no
    relay computers, `/connect` redirects home, settings search finds nothing about Connect,
    and the disable-network dialog says Loom. iPhone: Settings shows Computers only, computer
    details and the Library page have no Connect section or button, and the
    `connect-onboarding` deep link returns. The `notifications` deep link shows Library
    notifications in a build with `LOOM_MOBILE_LIBRARY_PUSH_ENABLED=1` and upstream's Connect
    notice in any other build.
14. **Tidy up.** Optionally revoke "T3 Connect connect" sessions under **Connections >
    Authorized clients**, remove any computer still on T3's account page, and mark C05 Done.

**Rollback.** Pause the publisher, revert the flip merge, set `"enabled": true`, resume the
publisher and publish a new version, then re-link computers and sign in again. A retired build
clears link state on its first start, so a computer that ran one, including an update trial
that rolled back, returns unlinked. iPhone Connect returns only with the iPhone retirement and
its workflow change reverted together. The publisher's Connect switch stays for at least one
release cycle after the flip so this path exists, unless Kyle decides otherwise.
