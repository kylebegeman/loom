# Loom-owned connections: replacing T3 Connect

Status: **Selected, not started.** Kyle chose this direction on 2026-10-24: Loom Identity and
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

- **One sign-in per device, every computer.** A native client keeps one Identity refresh token
  per issuer and subject, stored with the platform's secret storage (desktop `safeStorage`,
  iOS Keychain). It exchanges a fresh Pocket ID access token at each computer's existing
  native session endpoint. The server rule stays: a computer session never outlives the
  access token it was issued for. Renewal happens on the client, before expiry.
- **The directory is the computer list.** Clients read computers and routes from the Library
  directory. Routes come from the signed descriptor, so a client never trusts a route the
  computer did not publish.
- **Reach is a public route behind Identity.** A computer that opts in runs `cloudflared` as a
  child of its server (the preview-links supervisor pattern) and publishes the tunnel hostname
  as a `public` route. The server still requires an Identity or paired credential for every
  request. Pairing remains the fallback for clients without Identity.
- **Upstream code stays.** Turning Connect off means not publishing its Clerk and relay
  config in Loom releases. Upstream already hides Connect surfaces when that config is absent,
  so no upstream Connect code is deleted and merges stay easy.

## Packets

| ID  | Packet                                     | Status   | Scope                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | L112 Identity renewal                      | Selected | Desktop and iPhone request `offline_access`, store the refresh token, and renew each computer session before it expires. Removing a connection or signing out revokes the refresh token. Browser clients keep manual sign-in, with the expiry notice from 5edf279f1d. |
| C02 | L113 Library computer list on every client | Selected | After one Library sign-in, desktop, web and iPhone list directory computers that are not yet connected and connect each one with the same Identity, without pairing codes.                                                                                            |
| C03 | L114 Reach from anywhere                   | Selected | Per-computer Cloudflare tunnel on Kyle's account, provisioned from the Library with a Vault-held Cloudflare token, supervised by the computer's server and published as a directory route. Includes turning reach off and removing the tunnel.                        |
| C04 | L115 Push infrastructure                   | Selected | Library device registry and APNs sender with Kyle's team key, behind an off switch. The iPhone registers with the Library only when enabled. Integration waits for Kyle.                                                                                              |
| C05 | L116 Connect off in Loom builds            | Selected | Stop publishing Clerk and relay config, verify every Connect surface hides cleanly on desktop, web and iPhone, and retire the fork's `fleet-connect` seams and Connect help text.                                                                                     |

## Decisions

- **Route domain (2026-10-24).** Computer hostnames live under `loom.begam.in`. `bagels.top`
  stays reserved for preview pages.
- **Refresh token lifetime (2026-10-24).** 30 days with Cloudflare Access in front of computer
  routes, 7 days without it.
- **Exposure policy (2026-10-24).** Kyle chose more security over the lightest setup, in two
  steps. First, computer routes ship with edge hardening: only the paths a Loom client needs
  are forwarded, with rate limits, and the computer's server still requires Identity. Second,
  Cloudflare Access goes in front with Pocket ID as its identity provider, so a passkey
  sign-in admits the device and unauthenticated traffic never reaches Loom. Step two waits
  until Cloudflare's native-app token flow is verified on desktop and iPhone, including
  WebSockets. If Access cannot work cleanly, routes stay on step one and the refresh token
  lifetime stays at 7 days.

## Decisions still open

- **Pocket ID client settings.** Confirm the desktop and iPhone clients may receive refresh
  tokens.
