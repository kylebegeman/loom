const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --text: #1d1d1f; --muted: #5f5f66; --bg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --text: #f2f2f4; --muted: #a1a1aa; --bg: #161618; } }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
main { box-sizing: border-box; max-width: 34rem; min-height: 100vh; margin: 0 auto; padding: 2rem 1.5rem; display: flex; flex-direction: column; justify-content: center; }
h1 { font-size: 1.375rem; line-height: 1.3; margin: 0 0 0.5rem; font-weight: 600; }
p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
</main>
</body>
</html>
`;

export const endedPage = page(
  "This preview has ended",
  "The link expired or was turned off. Restore it or share the port again from Loom.",
);

export const openFromLoomPage = page(
  "Open this link from Loom",
  "Preview links only open in a browser that came from Loom, so open this link from the Loom app.",
);

export const entryUsedPage = page(
  "Open the preview again from Loom",
  "This sign-in link was already used or has expired. Open the preview again from the Loom app.",
);

export const portDeniedPage = page(
  "This port can't be previewed",
  "Loom keeps this port private because system or Loom services use it.",
);

export const crossSitePage = page(
  "Request blocked",
  "This request came from another site, so Loom did not pass it on.",
);

export const nothingListeningPage = (port: number) =>
  page(
    `Nothing is answering on port ${port} yet`,
    "Start the server on this computer, then reload this page.",
  );
