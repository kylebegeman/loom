# L72 product

## Problem

Kyle drives agents on one computer from a phone, a laptop or app.t3.codes. When an agent
starts a dev server, the client on the other device cannot load `localhost:5173`, and a
private network address only works at home or over Tailscale. He needs a link that opens the
running app from any device without exposing it to anyone who sees the link.

## Who and what

The user (Kyle) shares a port on the computer an environment runs on. Loom gives it an HTTPS
address on his own domain:

```
https://<port>-<share>-<machine>.<domain>/
https://5173-k3f9x2-dorothy.example.com/
```

- `port` is the local port, `share` is six random lowercase letters or digits, fresh for each
  link, and `machine` is the computer name from settings (up to 40 lowercase letters and
  digits, defaulting to the host name's first label).
- The whole name is one label under the domain because Cloudflare's free certificate covers
  only names one level below the zone.

The address opens only in a browser that entered from Loom. Opening it from a Loom client
mints a single-use sign-in that drops the browser on the page; any other browser sees "Open
this link from Loom". A browser stays signed in to that one link for up to 12 hours.

## What the user can do

- Turn on preview links, set the domain, computer name, default lifetime and gateway port, and
  paste the tunnel's connector token (Settings > Loom > Previews, web and desktop).
- Share a port from the preview panel: a loopback address the client cannot reach becomes a
  link and opens in the panel. A running server's card has **Copy preview link** and **Open
  in browser**.
- Open, copy, extend, end and restore links from the links sheet (web and desktop) or
  Settings > Previews (mobile). End all links, or sign out every browser that entered one.
- Open a link an agent posted by clicking it in the thread, on web, desktop or mobile.

## Lifetimes and restore

- A link stays open for 1 hour, 12 hours or 24 hours; the default is 12 hours and is a
  setting. Extending sets the end to that long from now.
- An ended link (expired, ended by hand, or ended with its lane) can be restored for 7 days
  at the same address. After that it is removed.
- Sharing a port that already has an open link returns that link instead of a second one.
- Changing the domain or computer name ends every open link, because every address moves.
  Links made under the old name leave the list and cannot be restored until the setting
  changes back.

## Agent policy

- An agent can share a port in its thread's lane (20 ports from the lane's base), or a port
  where a server started from that thread's terminal is listening. Anything else fails with
  a reason naming both rules.
- An agent's lane link ends when Loom sees the lane released.
- An agent can list and end only its own thread's links. It never receives a sign-in code;
  it posts the canonical link and the user opens it from Loom.

## Ports that are never shared

Ports below 1024, SSH (22), common databases (3306, 5432, 6379, 27017), browser and Node
debuggers (9222, 9229), the switchboard (8317), Loom's own ports (3773, the gateway port,
the server's configured port, the dev web port) and the tunnel's metrics port. The check
runs at share time and on every request.

## Entry points

- Settings > Loom > Previews (web and desktop) and Settings > Previews (mobile). Mobile shows
  setup status read-only.
- Command palette: "Preview links" opens the links sheet, "Preview link settings" opens the
  settings section.
- Preview panel navigation, the port card, chat and terminal links, and the panel's "Open in
  browser".
- Mobile: any preview link opened from the app, in messages, pull requests, files or rendered
  pages.
- Agents: `loom_preview_links_list`, `loom_preview_link_share`, `loom_preview_link_revoke`.
- Ways out: End, End all links, Sign out preview browsers, turning previews off, removing the
  connector token. Ended links stay visible and restorable for 7 days.

## States

- Setup: "Previews off", "Needs a domain", "Gateway error", "Needs a tunnel token", "Tunnel
  starting", "Tunnel error", "Ready on <domain>".
- Links: open with time left, or ended or expired with how long ago, newest first.
- Unsupported: a server without the feature, or a connection without the preview scope,
  explains itself instead of offering actions.

## Surfaces and connection modes

Supported on web, desktop and mobile. Links matter only where the client cannot reach the
computer's loopback: remote, relay and T3 Connect clients, the desktop app connected to
another computer, and the system browser on another device. A server-drawn preview on the
same computer keeps loading `localhost`. An upstream T3 server offers no links: an
unreachable loopback still shows an error, now pointing at Settings > Loom > Previews.

## Decisions

- Domain `bagels.top` for Kyle's own setup (2026-10-18); any Cloudflare zone works.
- One label per host, for Cloudflare's free Universal SSL.
- Entry codes and a host-only cookie instead of bearer URLs, so links in transcripts are not
  credentials. See [TECHNICAL.md](./TECHNICAL.md#security-reasoning).
- Settings, links and secrets stay on the computer; nothing is stored in the Library.
- One domain is enough for every computer. In this slice the wildcard record routes the
  domain to one computer's tunnel. A later slice routes other computers' links on the same
  domain: the Library adds an exact DNS record per link to that computer's tunnel, which
  outranks the wildcard. The computer name keeps addresses distinct across computers.
- Slices 2 to 6 (hosted HTML and Dossier documents, interactive pages with replies,
  containers) are future work. They need Library schema changes and Kyle's approval.
