# Reach operations

Reach gives a computer a public address, `https://<name>-loom.<zone>/`, through a Cloudflare
tunnel its Library sets up. This guide covers the Library side: the zone, the Cloudflare token,
the optional Pocket ID admin key, edge checks, rollout, rotation and removal. What people see is
in the [Connections guide](../user/connections.md#reach-a-computer-from-anywhere). Design,
decisions and residual risks are in the [L114 packet](../packets/L114-reach/README.md).

Everything ships off. A Library offers reach only when it is the Library authority with an https
`LOOM_IDENTITY_REDIRECT_URI` (so its directory runs), `LOOM_REACH_ZONE` is a valid zone and
`LOOM_REACH_CLOUDFLARE_TOKEN_FILE` is set. A computer does nothing until someone turns reach on
for it.

## Choose the zone

- Addresses are one label under the zone, `<name>-loom.<zone>`, because Cloudflare's Universal
  SSL certificate covers only one level of subdomain. A taken name gets a number,
  `<name>-2-loom.<zone>`.
- Use a zone that does nothing but reach, ideally in its own Cloudflare account. The token needs
  DNS edit rights on the zone, so on `begam.in` a leaked token could repoint `id.loom.begam.in`
  or the Library itself. The zone choice is open for Kyle (D2); no code depends on it.
- The rate-limit rule matches paths only, so it applies to the whole zone: `/oauth/token`,
  `/api/auth/session`, `/api/auth/websocket-ticket` and `/api/loom/identity/session` on every host
  in the zone get 60 requests per 10 seconds per client address and Cloudflare data center. A
  shared zone limits the Library too.
- The free plan has one rate-limit rule. If another rule already holds it, reach runs without a
  rate limit and the Library's Reach addresses section says so.
- Host nothing else in the zone whose name contains `-loom.<zone>`. The allowlist rule blocks
  every path outside the reach list on those hosts.
- WebSockets must be on for the zone (Network settings; on by default).

## Create the Cloudflare token

Create a custom API token in the zone's account:

| Group   | Permission              | Resources               |
| ------- | ----------------------- | ----------------------- |
| Account | Cloudflare Tunnel: Edit | Only the zone's account |
| Zone    | DNS: Edit               | Only the reach zone     |
| Zone    | Zone WAF: Edit          | Only the reach zone     |
| Zone    | Zone: Read              | Only the reach zone     |

The API reference names the edit permissions "Write". Add a client IP filter for the Library's
egress addresses. The token never leaves the Library: each computer receives only its own
connector token, and the Library issues a fresh one at every start and every turn-on.

## Install the Library's files

| Variable                           | Meaning                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `LOOM_REACH_ZONE`                  | The reach zone, such as `reach.example`. Required; there is no default. |
| `LOOM_REACH_CLOUDFLARE_TOKEN_FILE` | Path to the file holding the Cloudflare token.                          |
| `LOOM_IDENTITY_ADMIN_API_KEY_FILE` | Optional. Path to a file holding a Pocket ID admin API key.             |
| `LOOM_IDENTITY_ISSUER`             | The https Pocket ID issuer. Its origin also serves the admin API.       |
| `LOOM_IDENTITY_NATIVE_CLIENT_ID`   | The native client each computer's Pocket ID resource is granted to.     |

Each file must be a regular file with no group or other permission bits (mode 0600), at most
16 KiB, holding one value. The Library reads it on every call, so replacing a file needs no
restart; changing a variable does. Install the files through the Library's deploy procedure,
outside the T3 home and any project folder. Never put the values in environment variables,
command arguments, the repository or chat.

The files are protected by mode only. Anything running as the Library's server user can read
them, including a terminal or an agent on the Library. A Library authority runs with execution
off unless `LOOM_EXECUTION_ENABLED` is set; keep it off. That switch is enforced by clients, not
the server, which is one more reason to keep the Pocket ID key on disk only while it is needed.

After a restart, Settings > Connections on the Library shows a Reach addresses section with the
zone, the state of both files and, after the first computer turns reach on, the edge rules. The
section stays hidden while the zone is invalid or the token file variable is unset.

## Pocket ID admin key, on demand

Reach works without the key. The Library then sets up tunnels and addresses but does not prepare
Loom sign-in for the computer, and the key's state shows as missing, which is normal. The
default pending Kyle (D1) is to supply the key only while a computer sets up:

1. In Pocket ID, create an admin API key with a short expiry.
2. Write it to the key file, mode 0600.
3. Turn reach on for the computer, or turn it off and on again, or restart Loom on it. The
   Library creates the computer's Pocket ID API resource, `<Library origin>/computers/<environment
id>`, only during that setup, and grants it to the native client.
4. Delete the file, then the key in Pocket ID.

A resource the Library already prepared stays usable without the key. Retiring a computer with
"Also end Loom sign-in for this computer" needs the key in place; without it, the resource stays
and the Library keeps vouching for it.

The admin key can rewrite the native client's callback URLs. A leaked key plus one click by the
account owner on a genuine sign-in link yields a passkey sign-in to any computer. Checking for
callback drift is a follow-up decision, not built.

Once the Library prepared sign-in, the computer's own Reach section (on that computer only)
offers the four lines to copy: `LOOM_IDENTITY_ISSUER`, `LOOM_IDENTITY_NATIVE_CLIENT_ID`,
`LOOM_IDENTITY_AUDIENCE` and `LOOM_IDENTITY_RESOURCE`. Set them in the computer's server
environment and restart Loom. Its Identity sessions rotate once.

## Roll out

1. Release the build as a patch. Update desktop and iPhone everywhere first, so the passkey and
   resource messages are present before any computer needs them.
2. On the live Pocket ID, sign in with a passkey through the native client and decode the ID
   token, first and again after a refresh. `amr` must be an array containing `phr`; a missing or
   non-array `amr` makes every ID token fail. Then set `LOOM_IDENTITY_REQUIRE_PASSKEY=true` on the
   Library and on each computer that will use reach. Only the exact value `true` is accepted, any
   other value stops Identity from starting, and sessions rotate once.
3. In loom-platform, raise the native client's refresh lifetime to 10080 minutes and turn on
   `skipConsent` (branch `identity/native-refresh-7d`).
4. On the Library, install the token file, set the variables, add the Pocket ID key according to
   the D1 choice and restart. Confirm which hosts in the zone are proxied.
5. Turn reach on for one computer and run the edge checks below.
6. Turn it on for more computers. Move Identity computers that use reach to the resource the
   Library prepared.

`LOOM_IDENTITY_ALLOW_ADMIN=true` gives Identity sessions `relay:write`, which is enough to turn
reach on or off and to remove an address. The scopes gate the buttons only: a device with
terminal or full-access agent rights on a computer can change its reach anyway.

## Check the edge

Run these from a machine off your network, with `H` set to the computer's address:

```sh
H=https://studio-loom.reach.example
for p in / /mcp /oauth/mcp/authorize /api/hooks/x /api/loom/identity/login; do
  curl -s -o /dev/null -w "%{http_code} $p\n" "$H$p"
done
curl -s -o /dev/null -w "%{http_code}\n" "$H/api/assets/..%2fmcp"
for p in /.well-known/t3/environment /api/auth/session /api/loom/identity; do
  curl -s -D - -o /dev/null "$H$p" | grep -i '^set-cookie' || echo "no cookie $p"
done
curl -s "$H/api/loom/identity"
```

- The first loop prints 403 for each path. That answer comes from the Cloudflare allowlist rule.
- The encoded traversal prints 400 from the computer's guard. It must never print 200.
- The cookie loop prints `no cookie` for each path. The computer strips every `Set-Cookie` header
  on its reach address.
- `/api/loom/identity` names the Library's issuer and, once the computer adopted the prepared
  values, its `/computers/<environment id>` resource.
- A desktop or iPhone on another network, with Tailscale off, connects through the address and
  receives live updates, which proves `/ws` upgrades. A native Loom sign-in and its renewal work
  over the address.

## Rotate

- **Cloudflare token.** Create the new token, write it to a new 0600 file in the same folder,
  `mv` it over the old file, then delete the old token in Cloudflare. No restart.
- **Pocket ID key.** The same way, or keep it on demand.
- **Connector tokens.** They rotate on their own: every computer start and every turn-on replaces
  the tunnel secret, drops existing connections and issues a fresh token. The computer keeps it
  in memory and in a 0600 file only while cloudflared runs. To rotate one now, turn reach off and
  on, or restart Loom on that computer.

When the Library's list shows more than one connector for a computer, a copy of its connector
may be running elsewhere. Rotate it as above; if extra connectors come back, Retire the computer.
A connector left behind by a hard crash keeps forwarding until the next successful setup or
Remove. Restart Loom on that computer instead of killing cloudflared by name.

## Turn off, remove and retire

- **Off** is local to the computer. Its connector stops and it stops publishing the address. The
  tunnel and DNS record stay, and turning reach on brings the same address back.
- **Remove** (on the computer or from a device paired with full access) stops the connector, then
  asks the Library to rotate the tunnel secret, drop connections, delete the tunnel and delete the
  DNS record if it still matches. The address stays reserved for this computer. The Pocket ID
  resource and grant stay, because Loom sign-in is the computer's own setting. If the Library is
  unreachable or the computer is signed out of it, removal finishes later, including after a
  restart.
- **Retire** runs on the Library, from Settings > Connections > Reach addresses on desktop or web
  or Settings > Computers on iPhone. It does the Library's half of Remove without the computer and
  forgets the computer's signing key, so the computer can claim its address again with a new key. A
  computer still signed in to the Library sets reach up again on its next start, so revoke its
  Library sign-in too. "Also end Loom sign-in for this computer" deletes its Pocket ID resource.

A Library refuses to forget a directory computer while any of its reach records is not removed,
including one whose first setup failed. Retire it first.

### Leftovers

A DNS record whose id or content no longer matches at removal is left alone. The Library's list then
shows "Removed, but a DNS record was left in place" with the record id. Check that record in
Cloudflare and delete it by hand if nothing else uses it.

Addresses are never reassigned automatically. To release one, wait at least a day after the
computer was retired, so devices that learned the address have dropped it and their sign-ins have
renewed. Then stop the Library, back up `fork/reach/library.json` in its state directory (the one
holding `statev2.sqlite`), delete that computer's entry under `computers` and start the Library.
If the computer turns reach on again, it gets a new address.

## Take reach off a Library

1. Retire every computer, ending Loom sign-in where wanted.
2. Unset `LOOM_REACH_ZONE` and `LOOM_REACH_CLOUDFLARE_TOKEN_FILE` and restart the Library. It
   stops offering reach.
3. Delete the edge rules by hand; the Library leaves them in place after the last computer goes.
   In the zone's WAF, delete the custom rule whose description starts with
   `loom-reach:allowlist` and the rate-limiting rule whose description starts with
   `loom-reach:ratelimit`. Check for DNS records commented `loom-reach:<environment id>` and
   tunnels named `loom-reach-<environment id>`.
4. Delete the Cloudflare token and its file, and any Pocket ID APIs named
   `<Library origin>/computers/...` you no longer need.

The Library checks its edge rules once per run. If someone edits or deletes them while it runs,
it restores them only after a restart, and until then each computer's own guard is the only
filter on its address.
