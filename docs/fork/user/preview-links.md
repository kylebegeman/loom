# Preview links

A preview link opens a dev server running on one of your computers from any device, at an
HTTPS address on your own domain:

```
https://5173-k3f9x2-dorothy.example.com/
```

The address names the port (`5173`), a random part that is new for every link, and the
computer. It opens only in a browser that entered from Loom, so a link that ends up in a chat,
a log or someone else's clipboard shows a page asking to open it from Loom instead of your
app.

Loom shares ports through a Cloudflare tunnel it runs on the computer. Nothing is opened on
your router, and the computer is never reachable from the network directly.

## Setting up a computer

You need a domain on Cloudflare. For now one domain serves links from one computer, because
its wildcard record sends every address to that computer's tunnel. Sharing from more
computers on the same domain is planned; you will not need another domain for it.

1. In the Cloudflare dashboard, create a tunnel of the Cloudflared type (a remotely managed
   tunnel). Copy its connector token, the long value in the install command Cloudflare
   shows. You do not need to install anything; Loom runs the connector.
2. Add a route to the tunnel for the hostname `*` on your domain, with service type HTTP and
   URL `127.0.0.1:3779`. Cloudflare calls this a published application route; older
   dashboards call it a public hostname. `3779` is the gateway port in Loom's settings; if
   you change it there, change it here too.
3. Cloudflare does not create DNS records for wildcard routes. In the domain's DNS, add a
   CNAME record named `*` pointing at `<tunnel ID>.cfargotunnel.com`, with the proxy on.
4. In Loom, open **Settings > Previews** for that computer. Turn on **Share ports as links**,
   enter the domain in **Link domain**, check **Computer name**, paste the token into
   **Connector token**, and choose **Save**.

Use the domain itself, such as `example.com`, not a subdomain. Cloudflare's free certificate
covers only names one level below it, which is where link addresses live.

The status reads **Ready on example.com** once the tunnel connects. Loom keeps the token on
the computer and never shows it again. **Remove** deletes it and stops the tunnel.

If the status shows **Gateway error**, another program is using the gateway port. Pick a
different **Gateway port** and use the same port in the tunnel's route.

Setup is in the web and desktop apps. The mobile app shows each computer's status under
**Settings > Previews**.

## Sharing a port

When you open a local address such as `localhost:5173` from a device that cannot reach that
computer, Loom shares the port and opens the link for you. This covers the preview panel and
its **Open in browser**, plus links in chat and the terminal when **Open links in** is set to
**T3 Code**.

In the preview panel, each running server has two buttons:

- **Copy preview link** shares the port and copies its address.
- **Open in browser** shares the port and opens it in your system browser.

Sharing a port that already has an open link gives you the same link again.

Some ports are never shared: ports below 1024, SSH, common databases, debuggers, and Loom's
own ports.

## Opening links from agents

Agents can share ports with the `loom_preview_link_share` tool and post the link in the
thread. An agent can share a port in its own lane (see
[Storage and lanes](./project-lifecycle.md#what-a-lane-owns)) or one where a server it started
in the thread's terminal is listening. It cannot share other ports, and it can end only links
its own thread shared. A link to a lane port ends when the lane is released.

Click or tap the link in the thread to open it, on web, desktop or mobile. Loom signs that
browser in to the link and drops you on the page.

## Lifetimes and restoring

A link stays open for 1 hour, 12 hours or 24 hours. **Default lifetime** in
**Settings > Previews** sets it for new links; 12 hours unless you change it.

Manage links from **Manage links** in Settings > Previews, the **Preview links** command in
the command palette, or Settings > Previews on mobile:

- **Open** signs a browser in and opens the link.
- **Copy link** copies its address.
- **Extend** keeps it open for the time you pick, counted from now.
- **End** closes it at once, including open connections such as live reload.
- **Restore** reopens an ended or expired link at the same address. You can restore a link
  for 7 days after it ends. If its port already has another open link, end that one first.

**End all links** closes every open link on that computer.

Changing the domain or the computer name ends every open link, because every address
changes. Those links cannot be restored.

## Signing out browsers

A browser stays signed in to a link for up to 12 hours. After that, open the link from Loom
again.

**Sign out preview browsers** in Settings > Previews signs out every browser that opened any
link on that computer. Links stay open; each browser has to open them from Loom again.
Removing a device's access to Loom also signs out the browsers it opened links in, and they
stay out after the computer restarts. The same happens when a device's Loom sign-in runs out,
even while that device is offline. Pages already open in those browsers lose their connection
too. Devices that reach this computer through T3 Connect count as one device here: removing
any of them signs out the browsers opened from all of them. Their sign-in renews every hour,
so their browsers stay in for 5 minutes after it runs out. Restarting the desktop app signs
out the browsers it opened links in from the computer it runs on. To be certain every browser
is out, use **Sign out preview browsers**.

## "Open this link from Loom"

You see this page when a browser that has not entered from Loom opens a link, for example
after pasting it into a new browser, a private window or another device. It also appears once
a browser's sign-in has run out or after you signed browsers out.

Open the link from Loom instead: click it in a thread, use **Open** on the link, or use
**Open in browser** from the preview panel. Loom hands the browser a one-time sign-in that
works for a minute.

**Open the preview again from Loom** means that one-time sign-in was already used or ran
out. Open the link from Loom again.

## Other pages you may see

- **This preview has ended**: the link expired, was ended or no longer exists. Restore it if
  it is still listed, or share the port again.
- **Nothing is answering on port 5173 yet**: start the server on the computer, then reload.
- **This port can't be previewed**: the port is one Loom keeps private.
- **Request blocked**: a request came from another site, so Loom did not pass it on.
- **Not found**: the address is for a different domain or computer name than the computer
  that answered. Check the domain, the computer name and the DNS record.
