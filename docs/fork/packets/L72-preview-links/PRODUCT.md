# L72 product

## Problem

Kyle drives agents on one computer from a phone, a laptop or app.t3.codes. When an agent
starts a dev server, the client on the other device cannot load `localhost:5173`, and a
private network address only works at home or over Tailscale. He needs a link that opens the
running app from any device without exposing it to anyone who sees the link. Agents also
produce things that are not dev servers: a built site, a container, a rendered page or a
Dossier asking for decisions. Those need the same private links, and a page needs a way to
answer the agent from wherever Kyle reads it.

## Who and what

The user (Kyle) is the only person any link or page opens for. There are four kinds of
thing he can open:

- **Port links.** He or an agent shares a port on the computer an environment runs on. Loom
  gives it an HTTPS address on his own domain:

  ```
  https://<port>-<share>-<machine>.<domain>/
  https://5173-k3f9x2-dorothy.example.com/
  ```

  `port` is the local port, `share` is six random lowercase letters or digits, fresh for each
  link, and `machine` is the computer name from settings (up to 40 lowercase letters and
  digits, defaulting to the host name's first label). The whole name is one label under the
  domain because Cloudflare's free certificate covers only names one level below the zone.

- **Folder links.** An agent serves a built folder from its workspace, such as `dist`, on one
  of its lane ports. The link looks like a port link. Loom serves the files read-only, with
  no dev server behind them.
- **Container links.** An agent runs a Docker image on one of its lane ports. The link looks
  like a port link and ends when the container stops.
- **Pages.** An agent publishes an html_render result or a workspace HTML file, such as a
  Dossier, to the Library. The page lives at `https://pages.<domain>/p/<id>` with a reply box
  under it. A reply arrives in the publishing thread as a queued message.

A link opens in a browser that entered from Loom: opening it from a Loom client mints a
single-use sign-in that drops the browser on the page. Any other browser gets a "Sign in
with Loom" link to the user's Library, which sends it back signed in. Pages always use the
Library sign-in. A browser stays signed in to one link, or to the pages host, for up to 12
hours.

## What the user can do

- Turn on preview links, set the domain, computer name, default lifetime and gateway port, and
  paste the tunnel's connector token (Settings > Loom > Previews, web and desktop).
- Share a port from the preview panel: a loopback address the client cannot reach becomes a
  link and opens in the panel. A running server's card has **Copy preview link** and **Open
  in browser**.
- Open, copy, extend, end and restore links from the links sheet (web and desktop) or
  Settings > Previews (mobile). End all links, or sign out every browser that entered one.
- Open a link an agent posted by clicking it in the thread, on web, desktop or mobile, or in
  any browser after signing in to the Library.
- See each computer's published pages under Pages in the same settings, and open, keep, stop
  keeping, end or restore them.
- Read a page and reply to the agent from under it.

## Lifetimes and restore

- Port and folder links stay open for 1 hour, 12 hours or 24 hours; the default is 12 hours
  and is a setting. Extending sets the end to that long from now. An ended link (expired,
  ended by hand, or ended with its lane) can be restored for 7 days at the same address.
  After that it is removed.
- Container links run 2 hours by default and at most 4, as the agent asks. They cannot be
  extended or restored, because ending removes the container; the agent shares the image
  again for more time.
- Pages last 30 days unless kept. A kept page never expires; stopping keeping it starts a
  fresh 30 days. An ended or expired page can be restored for 7 days, with a fresh 30 days.
  After that the Library deletes it and its replies.
- Sharing a port, or the same folder from the same thread, that already has an open link
  returns that link instead of a second one. Republishing a page from its thread keeps its
  address.
- Changing the domain or computer name ends every open link, because every address moves.
  Links made under the old name leave the list and cannot be restored until the setting
  changes back.

## Agent policy

- An agent can share a port in its thread's lane (20 ports from the lane's base), or a port
  where a server started from that thread's terminal is listening. Anything else fails with
  a reason naming both rules.
- Folder and container links are agent-only and always take a free port from the thread's
  lane, so they need lanes on. A folder must be a directory inside the thread's workspace.
- An agent's lane link ends when Loom sees the lane released, and a container is removed
  with it.
- An agent can list and end only its own thread's links, and list and change only its own
  thread's pages. It never receives a sign-in code; it posts the canonical link or page
  address and the user opens it.
- A reply is untrusted text, and it is a prompt-injection surface by design: the reply box
  exists so the user can steer the agent. Only the Library's owner can sign in to the pages
  host, so only the user can post one. A reply enters the thread only as a queued message
  that names the page it came from.

## Ports that are never shared

Ports below 1024, SSH (22), common databases (3306, 5432, 6379, 27017), browser and Node
debuggers (9222, 9229), the switchboard (8317), Loom's own ports (3773, the gateway port,
the server's configured port, the dev web port) and the tunnel's metrics port. The check
runs at share time and on every request.

## Entry points

- Settings > Loom > Previews (web and desktop) and Settings > Previews (mobile), each with a
  Pages list per computer. Mobile shows setup status read-only.
- Command palette: "Preview links" opens the links sheet, "Preview link settings" opens the
  settings section.
- Preview panel navigation, the port card, chat and terminal links, and the panel's "Open in
  browser".
- Mobile: any preview link opened from the app, in messages, pull requests, files or rendered
  pages.
- The 401 page of a link or page in a browser without a sign-in: "Sign in with Loom".
- Agents: `loom_preview_links_list`, `loom_preview_link_share`, `loom_preview_folder_share`,
  `loom_preview_container_share`, `loom_preview_link_revoke`, `loom_page_publish`,
  `loom_pages_list` and `loom_page_update`.
- Ways out: End, End all links, Sign out preview browsers, turning previews off, removing the
  connector token, and End on a page. Ended links and pages stay visible and restorable for 7
  days, except container links, which leave the list when they end.

## States

- Setup: "Previews off", "Needs a domain", "Gateway error", "Needs a tunnel token", "Tunnel
  starting", "Tunnel error", "Ready on <domain>".
- Links: open with time left, or ended or expired with how long ago, newest first. Folder
  and container links add a line naming the folder, or the image and when it stops.
- Pages: open with time left or "Kept", or ended or expired with how long they stay
  restorable. A computer whose Library does not serve pages says so instead of listing.
- Page host: "This page has ended or expired", "This page could not load" when the Library
  cannot answer, and "Sign-in is unavailable" when it cannot read its sign-in key.
- Unsupported: a server without the feature, or a connection without the preview scope,
  explains itself instead of offering actions.

## Surfaces and connection modes

Supported on web, desktop and mobile. Links matter only where the client cannot reach the
computer's loopback: remote, relay and T3 Connect clients, the desktop app connected to
another computer, and the system browser on another device. A server-drawn preview on the
same computer keeps loading `localhost`. Pages are served by the Library, so they open the
same way from every device and keep working while the publishing computer is off; only
replies wait for it. An upstream T3 server offers no links or pages: an unreachable loopback
still shows an error, now pointing at Settings > Loom > Previews.

## Decisions

- Domain `bagels.top` for Kyle's own setup (2026-10-18); any Cloudflare zone works.
- One label per host, for Cloudflare's free Universal SSL.
- Entry codes and a host-only cookie instead of bearer URLs, so links in transcripts are not
  credentials. See [TECHNICAL.md](./TECHNICAL.md#security-reasoning).
- Link settings, links and secrets stay on the computer. The Library learns only which
  hosts each computer serves, so it can sign browsers in for them.
- Library sign-in uses the Library's own login, so a browser on any device gets in without a
  Loom client, and the computer never sees the user's Library credentials.
- Pages live in the Library at `pages.bagels.top` so they outlive the computer: a page stays
  readable while the computer sleeps, and replies wait there for it.
- Pages get their own host, never the Library's, so a published page cannot reach the
  Library's app or API with the reader's session.
- One domain is enough for every computer's links. The wildcard record routes the domain to
  one computer's tunnel; routing other computers' links on the same domain would need an
  exact DNS record per link, which is not built. The computer name keeps addresses distinct
  across computers.
- Slice 6, guest links for other people, is parked under the one-operator rule.
