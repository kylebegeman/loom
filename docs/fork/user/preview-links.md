# Preview links

A preview link opens something running on one of your computers from any device, at an
HTTPS address on your own domain:

```
https://5173-k3f9x2-dorothy.example.com/
```

The address names the port (`5173`), a random part that is new for every link, and the
computer. Agents can also publish a page, such as a rendered page or a Dossier, to your
Library, where you can read it from anywhere and reply to the agent under it.

Links and pages open only for you: in a browser you opened them in from Loom, or in one you
signed in to your Library. A link that ends up in a chat, a log or someone else's clipboard
shows a sign-in page instead of your app.

Loom shares ports through a Cloudflare tunnel it runs on the computer. Nothing is opened on
your router, and the computer is never reachable from the network directly.

## Setting up a computer

You need a domain on Cloudflare. One domain serves links from one computer, because its
wildcard record sends every address to that computer's tunnel.

1. In the Cloudflare dashboard, create a tunnel of the Cloudflared type (a remotely managed
   tunnel). Copy its connector token, the long value in the install command Cloudflare
   shows. You do not need to install anything; Loom runs the connector.
2. Add a route to the tunnel for the hostname `*` on your domain, with service type HTTP and
   URL `127.0.0.1:3779`. Cloudflare calls this a published application route; older
   dashboards call it a public hostname. `3779` is the gateway port in Loom's settings; if
   you change it there, change it here too.
3. Cloudflare does not create DNS records for wildcard routes. In the domain's DNS, add a
   CNAME record named `*` pointing at `<tunnel ID>.cfargotunnel.com`, with the proxy on.
4. In Loom, open **Settings > Loom > Preview links** for that computer. Turn on
   **Share ports as links**, enter the domain in **Link domain**, check **Computer name**,
   paste the token into **Connector token**, and choose **Save**.

Use the domain itself, such as `example.com`, not a subdomain. Cloudflare's free certificate
covers only names one level below it, which is where link addresses live.

The status reads **Ready on example.com** once the tunnel connects. Loom keeps the token on
the computer and never shows it again. **Remove** deletes it and stops the tunnel.

If saving reports that the port is in use, or the status shows **Gateway error**, another
program is using the gateway port. Pick a different **Gateway port** and use the same port in
the tunnel's route.

Loom keeps `cloudflared` up to date itself. If it finds an older copy on your computer, the
status shows **Installing cloudflared** briefly while it fetches the current release, and it
keeps using the older copy if the download fails.

Setup is in the web and desktop apps. The mobile app shows each computer's status under
**Settings > Previews**.

To open links by signing in to your Library, and to publish pages, the computer needs a
Library connection (see [Library projects](../../user/project-settings.md#library-projects-and-working-copies)).

## Sharing a port

When you open a local address such as `localhost:5173` from a device that cannot reach that
computer, Loom shares the port and opens the link for you. This covers the preview panel and
its **Open in system browser**, and links in chat and the terminal wherever **Open links in**
sends them. On mobile it covers links in a thread.

In the preview panel, each running server has two buttons:

- **Copy preview link** shares the port and copies its address.
- **Open in browser** shares the port and opens it in your system browser.

Sharing a port that already has an open link gives you the same link again.

Some ports are never shared: ports below 1024, SSH, common databases, debuggers, and Loom's
own ports.

## Links from agents

Agents can share ports and post the link in the thread. An agent can share a port in its own
lane (see [Storage and lanes](./project-lifecycle.md#what-a-lane-owns)) or one where a server
it started in the thread's terminal is listening. It cannot share other ports, and it can end
only links its own thread shared. A link to a lane port ends when the lane is released.

Click or tap the link in the thread to open it, on web, desktop or mobile. Loom signs that
browser in to the link and drops you on the page.

### Folders and containers

Ask an agent to share a built site or a container, and it gets a link like any other:

- **A folder link** serves a built folder from the thread's workspace, such as `dist`. Ask
  the agent to build first; a folder link serves files as they are and does not run a dev
  server. Addresses without a file, such as a single-page app's client routes, show
  **Not found**. Video and audio can seek.
- **A container link** runs a Docker image. It runs for 2 hours unless you ask for a
  different time, up to 4 hours. It cannot be extended or restored: ending it removes the
  container. For more time, ask the agent to share it again. If the image is not on the
  computer yet, Docker downloads it first, which can take up to 10 minutes.

Both need lanes on (**Settings > Loom > Storage**), because they use the thread's lane ports
and end with its lane. Container links also need Docker Desktop or OrbStack running on the
computer. Containers stop when Loom quits. One that could not be removed while Docker was not
running is removed once Docker answers again.

A folder link comes back only on the lane it was shared from. If that lane is gone, or lanes
are off, **Restore** says so; ask the agent to share the folder again.

## Lifetimes and restoring

A link stays open for 1 hour, 12 hours or 24 hours. **Default lifetime** in
**Settings > Loom > Preview links** sets it for new links; 12 hours unless you change it.

Manage links from **Manage links** in Settings > Loom > Preview links, the **Preview links** command
in the command palette, or Settings > Previews on mobile:

- **Open** signs a browser in and opens the link.
- **Copy link** copies its address.
- **Extend** keeps it open for the time you pick, counted from now.
- **End** closes it at once, including open connections such as live reload.
- **Restore** reopens an ended or expired link at the same address. You can restore a link
  for 7 days after it ends. If its port already has another open link, end that one first.

**End all links** closes every open link on that computer.

Changing the domain or the computer name ends every open link, because every address
changes. Those links leave the list and cannot be restored. Change the setting back within
7 days and they return, ready to restore.

## Published pages

An agent can publish a page it rendered, or an HTML file from its workspace such as a
Dossier. The page lives in your Library at an address on its own pages host, so it stays
readable while the computer is asleep.

Each computer's pages are listed under **Pages** in **Settings > Loom > Preview links**, or under
**Pages on** the computer in Settings > Previews on mobile:

- **Open** opens the page in your browser.
- **Keep** stops it from expiring. **Stop keeping** gives it a fresh 30 days.
- **End** closes it at once.
- **Restore** reopens an ended or expired page for a fresh 30 days. You can restore a page
  for 7 days after it ends; after that your Library deletes it.

A page stays open for 30 days unless you keep it. The list updates on its own when this
computer publishes or changes a page; pages that expire show up the next time you open it.
If the list says **Your Library does not publish pages yet**, the Library this computer uses
does not serve pages.

A computer can have 500 open pages. At that point publishing and restoring are refused until
you end some. Your Library also keeps up to 1,000 pages per computer, counting ended ones;
past that, publishing removes the pages that ended longest ago.

### Replying to the agent

Type in **Reply to the thread** under a page and choose **Send to thread**, or press
Cmd+Enter (Ctrl+Enter on Windows and Linux). The reply arrives in the conversation that
published the page as a queued message. If the computer is off, the reply waits in your
Library and arrives when it is back. A reply to a conversation that was archived or deleted
is dropped.

A Dossier can fill the reply box with your decisions. Nothing is sent until you choose
**Send to thread**.

## Signing in

Opening a link from Loom signs that browser in for you. In any other browser, a link or page
shows **Sign in to see this preview**. Choose **Sign in with Loom**, sign in to your Library
if it asks, and you land on the page. This works on any device, without the Loom app.

A browser stays signed in to a link, or to your pages, for up to 12 hours. After that, open
the link from Loom or sign in again.

Signing in works for every computer connected to your Library, and for the computer your
Library runs on. After your Library is updated, signing in to a computer's links can fail for
up to 30 minutes, until that computer checks in again. Opening links from Loom still works,
and restarting Loom on that computer is quicker. Removing a computer's access to your Library
stops sign-in to its links at once. Computers that connected with one shared Library token
lose it together. **Library** under Connection status in Settings > Loom > Preview links, and
on the computer's previews screen in the mobile app, shows whether your Library can sign
browsers in to this computer's links, and why not when it cannot.

**Sign out preview browsers** in Settings > Loom > Preview links signs out every browser that
opened any link on that computer, whether it came from Loom or signed in to your Library. It
also signs every browser out of your published pages, from every computer. Links and pages
stay open; each browser has to open them from Loom or sign in again. If your Library cannot be
reached at that moment, links are still signed out, but pages are not.

Removing a device's access to Loom also signs out the browsers it opened links in, and they
stay out after the computer restarts. The same happens when a device's Loom sign-in runs out,
even while that device is offline. Pages already open in those browsers lose their connection
too. Devices that reach this computer through T3 Connect count as one device here: removing
any of them signs out the browsers opened from all of them. Their sign-in renews every hour,
so their browsers stay in for 5 minutes after it runs out. Restarting the desktop app signs
out the browsers it opened links in from the computer it runs on. To be certain every browser
is out, use **Sign out preview browsers**.

## Pages you may see

- **Sign in to see this preview**: this browser has not signed in. Choose
  **Sign in with Loom**, or open the link from Loom.
- **Open this link from Loom**: this browser has not signed in, and the computer has no
  Library to sign in through. Click the link in a thread, use **Open** on the link, or use
  **Open in browser** on a running server in the preview panel.
- **This sign-in expired or was already used**, or **Open the preview again from Loom**: a
  one-time sign-in works once, within a minute, and not after the computer or your Library
  restarts. Sign in again, or open the link from Loom again.
- **This preview has ended**: the link expired, was ended or no longer exists. Restore it if
  it is still listed, or share the port again.
- **Nothing is answering on port 5173 yet**: start the server on the computer, then reload.
- **This port can't be previewed**: the port is one Loom keeps private.
- **Request blocked**: a request came from another site, so Loom did not pass it on.
- **Not found**: the address is for a different domain or computer name than the computer
  that answered. Check the domain, the computer name and the DNS record. On a folder link, the
  folder has no file at that address.
- **This page has ended or expired**: restore the page from Pages, or ask the agent to
  publish it again.
- **This page could not load**: your Library could not answer. Reload to try again.
- **Sign-in is unavailable**: your Library could not read the key it signs pages sign-ins
  with, so it signs no one in. Check the Library server's logs.
