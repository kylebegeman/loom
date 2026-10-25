# L114: Reach

Status: Built, off (C03 of [Loom-owned connections](../LOOM-CONNECTIONS.md)). Live Cloudflare
and Pocket ID checks and Kyle's Library setup are pending.

A computer can be reached from anywhere at `https://<name>-loom.<zone>/` without Tailscale or
T3 Connect. Its Library holds the only Cloudflare token and sets up one remotely managed tunnel,
one proxied DNS record and, when a Pocket ID admin key is present, one Pocket ID API resource per
computer. The computer runs cloudflared with a connector token it receives at each setup and
publishes the address as a `public` route. Every request that acts on the computer still needs a
credential: a pairing, a Loom Identity sign-in or a paired device's session.

## Scope

- In: the Library's provisioning service and signed `/api/loom/reach/*` routes; the computer's
  connector, request guard and published route; the Library's computer list with Retire; reach
  switches on desktop, web and iPhone; MCP tools; Pocket ID resource preparation and its
  attestation in the directory; the passkey-only Identity policy.
- Out: an MCP tool that turns reach on, callback drift checks on Pocket ID, Cloudflare Access in
  front of the address, and a Command Palette entry and Settings search.

## How it fits together

- **Edge.** One WAF block rule on the zone allows only the reach methods and paths on hosts that
  contain `-loom.<zone>`, plus the free plan's one rate-limit rule on the sign-in paths. Both
  rules carry a `loom-reach:` description, and the Library manages only rules with that prefix.
- **Guard.** The computer's global middleware applies the same allowlist from the same constant
  (`packages/shared/src/fork/reach.ts`), refuses traversal and `X-Forwarded-Host`, strips every
  `Set-Cookie`, accepts only pairing-code exchanges at `/oauth/token`, and answers 404 while
  reach is off. The edge follows the Library's version and the guard follows the computer's, so
  an allowlist change ships in both.
- **Requests.** Computers ask their Library with an Ed25519-signed request (60 seconds, strictly
  increasing sequence) from the key the directory already pinned, sent with the computer's own
  Library publisher session. The Library pins the key at the first setup and refuses any other
  key until Retire.
- **Connector token.** Every setup rotates the tunnel secret, drops existing connections and
  returns a fresh token. The computer never stores it; it lives in memory and in a 0600 file
  under the state directory only while cloudflared runs.
- **Routes.** Clients rank `public` after LAN and tailnet and pick it up on their next connect.
  Browsers sign in to a directory computer over tailnet, and pair when only the public route
  answers. The directory lists a computer's public route only while the Library's record for it
  is ready.

The operator runbook is [docs/fork/operations/reach.md](../../operations/reach.md). The user
guide section is
[Reach a computer from anywhere](../../user/connections.md#reach-a-computer-from-anywhere).

## Surfaces

| Surface         | Where                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop and web | Settings > Connections: "Reach from anywhere" in this computer's details and in each saved computer's details; Reach addresses on a Library. |
| iPhone          | A computer's details: Reach switch, Copy address, Remove address. Settings > Computers: Reach addresses with Retire.                         |
| Agents          | `loom_reach_status`, `loom_reach_off`, `loom_reach_remove`, `loom_reach_computers`, `loom_reach_retire`. No tool turns reach on.             |
| Older clients   | Drop the `public` endpoint. They cannot decode a `reach-active` refusal or reach states they do not know.                                    |

The switch needs `relay:write`; Retire needs `settings:write`. A device without them sees "Turn
reach on or off from the computer itself or from a device paired with full access."

## Decisions (defaults pending Kyle)

Everything ships off, so each default is reversible.

| ID  | Default                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The Pocket ID admin key is an optional file read on every call. The runbook recommends supplying it on demand during a setup, then deleting it. |
| D2  | `LOOM_REACH_ZONE` is required and has no default. A dedicated zone, ideally in its own Cloudflare account, is recommended over `begam.in`.      |
| D3  | `LOOM_IDENTITY_REQUIRE_PASSKEY=true` is opt-in and independent of the session age cap.                                                          |
| D4  | Each computer's resource is `<Library origin>/computers/<environment id>`, derived by the Library.                                              |
| D5  | One zone-wide rate-limit rule: 60 requests per 10 seconds per client and data center on four sign-in paths.                                     |
| D6  | Webhooks (`/api/hooks/*`) stay blocked on reach addresses.                                                                                      |
| D7  | Browser Identity sign-in stays off on reach addresses.                                                                                          |
| D8  | Library credentials are 0600 files named by environment variables.                                                                              |
| D9  | `relay:write` for the switch and Remove, `settings:write` for Retire. A UI gate only (F11 below).                                               |
| D10 | Agents can read reach and turn it off or remove it, never turn it on.                                                                           |
| D11 | The Library creates a computer's Pocket ID resource only during a reach setup.                                                                  |
| D12 | Off is local. Remove keeps the Pocket ID resource and grant. Retire with "Also end Loom sign-in" deletes the resource.                          |
| D13 | Edge rules stay after the last computer goes. Hostnames are sticky and never reassigned automatically.                                          |

Follow-up decisions for Kyle: checking the native client's callback URLs for drift (F3), an MCP
tool that turns reach on, and Cloudflare Access as a second step in front of the address.

## Residual risks

- **Pocket ID admin key (F3).** The key can rewrite the native client's callback URLs. A leaked
  key plus one click by the account owner on a genuine sign-in link yields a passkey sign-in to
  any computer. The passkey rule is a speed bump here, since a key holder can enroll a passkey.
- **Scopes are a UI gate (D9, F11).** A device with terminal or full-access agent rights on a
  computer can change its reach anyway. `LOOM_IDENTITY_ALLOW_ADMIN=true` gives Identity sessions
  `relay:write`.
- **Library files (F12).** They are protected by file mode only. A terminal or agent running as
  the Library's server user can read them. Keep execution off on the Library and keep the Pocket
  ID key on demand.
- **Orphan connector (F7).** A connector left by a hard crash keeps forwarding until the next
  successful setup or Remove. The guard still answers 404 while reach is off.
- **Leftover DNS (F13).** A record whose id or content changed is left alone and reported as
  `removed-with-leftover`. Releasing a hostname is a manual step after at least a day.
- **Unauthenticated surface (F6).** `/.well-known/t3/environment`, `GET /api/loom/identity`,
  `GET /api/auth/session`, the pairing-code exchange at `POST /oauth/token`, and signed asset and
  preview URLs, which work as bearer URLs.
- **Forget needs Retire.** A Library refuses to forget a directory computer while any reach
  record is not removed, including one whose first setup failed.
- **Saved computers.** A device that saved a computer before reach was on, is away and has no
  tailnet must connect once from home or reconnect from the Library list.
- **Resource pin (F4).** Directory sign-ins require the resource the Library attests. A saved
  connection stores the resource it signed in with, carries it onto routes learned later, and
  refuses a computer naming another one when it signs in again. A connection saved before this
  pins only its account until its next sign-in records one.
- **Browser passkey refusal.** A browser that signs in without a passkey to a computer that
  requires one sees the callback's `passkey_required` JSON in the sign-in window.

## Not verified live

All Cloudflare, cloudflared, Pocket ID and client behavior was checked with fakes. Still open:
that Cloudflare accepts the WAF expression, the rate-limit rule, DNS comments and per-rule PATCH
on the free plan; the tunnel list filters and connection fields; Pocket ID's API search and
whether its native ID tokens carry `amr` as an array containing `phr`, first and after a refresh;
and an end-to-end connection from desktop and iPhone over a real address.

## Packet seams

See [SEAMS.md](./SEAMS.md).
