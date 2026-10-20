import { PREVIEW_PAGE_REPLY_MAX, type PreviewPage } from "@t3tools/contracts/fork";
import {
  HTML_RENDER_DEFAULT_FONTS,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
} from "@t3tools/shared/htmlRender";
import {
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
  type ThemeColors,
} from "@t3tools/shared/themePalettes";

/**
 * The sandbox every published page runs in. It matches the app's own html_render asset policy:
 * never allow-same-origin, so a page cannot read the shell, its cookie or its reply endpoint, and
 * never allow-modals.
 */
export const RAW_PAGE_SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads";

/** Dossier pages report their own height; anything outside this is a broken or hostile page. */
const DOSSIER_MIN_HEIGHT = 80;
const DOSSIER_MAX_HEIGHT = 100_000;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** JSON inside a script element: `<` is escaped so no value can close the element. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

const THEMES = {
  light: htmlRenderTheme(T3_CODE_LIGHT_THEME_COLORS, "light", HTML_RENDER_DEFAULT_FONTS),
  dark: htmlRenderTheme(T3_CODE_DARK_THEME_COLORS, "dark", HTML_RENDER_DEFAULT_FONTS),
};

const THEME_FRAGMENTS = {
  light: htmlRenderThemeFragment(THEMES.light),
  dark: htmlRenderThemeFragment(THEMES.dark),
};

const THEME_MESSAGES = {
  light: htmlRenderThemeMessage(THEMES.light),
  dark: htmlRenderThemeMessage(THEMES.dark),
};

const shellColors = (colors: ThemeColors) =>
  [
    `--bg: ${colors.canvas};`,
    `--text: ${colors.text};`,
    `--muted: ${colors.mutedForeground};`,
    `--border: ${colors.border};`,
    `--field: ${colors.surface};`,
    `--field-border: ${colors.input};`,
    `--focus: ${colors.focus};`,
    `--action: ${colors.messageAction};`,
    `--action-text: ${colors.messageActionForeground};`,
    `--error: ${colors.errorForeground};`,
  ].join(" ");

const SHELL_STYLE = `
:root { color-scheme: light; ${shellColors(T3_CODE_LIGHT_THEME_COLORS)} }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; ${shellColors(T3_CODE_DARK_THEME_COLORS)} } }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 14px/1.5 ${HTML_RENDER_DEFAULT_FONTS.sans}; display: flex; flex-direction: column; min-height: 100vh; }
body.kind-html { height: 100vh; height: 100dvh; overflow: hidden; }
header { flex: none; padding: 10px 16px; border-bottom: 1px solid var(--border); }
h1 { margin: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
iframe { display: block; width: 100%; border: 0; background: var(--bg); }
.kind-html iframe { flex: 1 1 auto; min-height: 0; }
.kind-dossier iframe { height: 70vh; }
form { flex: none; border-top: 1px solid var(--border); background: var(--bg); padding: 12px 16px; }
.kind-dossier form { position: sticky; bottom: 0; }
.reply { max-width: 860px; margin: 0 auto; display: grid; gap: 8px; }
label { font-size: 12px; color: var(--muted); }
textarea { width: 100%; min-height: 64px; max-height: 40vh; resize: vertical; padding: 8px 10px; border: 1px solid var(--field-border); border-radius: 8px; background: var(--field); color: var(--text); font: inherit; }
textarea:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
#status { margin: 0; min-height: 1.5em; color: var(--muted); }
#status[data-tone="error"] { color: var(--error); }
button { flex: none; padding: 6px 14px; border: 0; border-radius: 8px; background: var(--action); color: var(--action-text); font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.6; cursor: default; }
`;

/**
 * Runs in the shell, never in the page. The page is another (opaque) origin that can post
 * anything at any time, so every message is checked for its source and shape, and only a click
 * on Send ever delivers a reply.
 */
const SHELL_SCRIPT = `((config) => {
  "use strict";
  const frame = document.getElementById("page");
  const form = document.getElementById("reply");
  const box = document.getElementById("reply-text");
  const send = document.getElementById("send");
  const status = document.getElementById("status");
  const say = (text, tone) => {
    status.textContent = text;
    status.dataset.tone = tone || "";
  };
  if (config.kind === "html") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    frame.src = config.raw + (media.matches ? config.fragments.dark : config.fragments.light);
    const retheme = () => {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage(media.matches ? config.themes.dark : config.themes.light, "*");
      }
    };
    if (media.addEventListener) media.addEventListener("change", retheme);
    else media.addListener(retheme);
  }
  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || !isRecord(event.data)) return;
    const data = event.data;
    if (data.type === "dossier:height") {
      if (config.kind !== "dossier" || typeof data.height !== "number" || !Number.isFinite(data.height)) return;
      const height = Math.min(config.maxHeight, Math.max(config.minHeight, Math.ceil(data.height)));
      frame.style.height = height + "px";
      return;
    }
    if (data.type === "dossier:decisions") {
      const decisions = data.decisions;
      if (config.kind !== "dossier" || !isRecord(decisions) || typeof decisions.reply !== "string")
        return;
      if (decisions.reply.length > config.replyMax) return;
      box.value = decisions.reply;
      if (decisions.reply.trim() === "") say("");
      else say("Decisions ready. Review and send.");
      return;
    }
    // Framed html_render pages ask their host to open links instead of navigating the frame.
    if (data.jsonrpc === "2.0" && data.method === "ui/open-link" && isRecord(data.params)) {
      const url = data.params.url;
      if (typeof url !== "string" || !/^https?:\\/\\//i.test(url)) return;
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
  // One id per draft: a retry of the same text reuses it, so a reply that did arrive is not
  // stored twice, and changed text gets a new one so it is never dropped as a duplicate.
  let draft = null;
  let sending = false;
  const failure = (code) => {
    switch (code) {
      case 400:
      case 413:
        return "This reply could not be sent. Check it and try again.";
      case 401:
        return "Your sign-in expired. Reload the page to sign in again.";
      case 404:
        return "This page has ended, so replies are closed.";
      case 429:
        return "Too many replies are waiting. Try again later.";
      default:
        return "Your Library could not take the reply. Try again.";
    }
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    const text = box.value;
    if (text.trim() === "") return say("Write a reply first.", "error");
    if (text.length > config.replyMax) return say("This reply is too long.", "error");
    if (draft === null || draft.text !== text) draft = { id: crypto.randomUUID(), text };
    sending = true;
    send.disabled = true;
    say("Sending...");
    try {
      const response = await fetch(config.replies, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replyId: draft.id, text }),
        credentials: "same-origin",
        cache: "no-store",
        // The shell's own no-referrer policy would send Origin: null, which the host refuses.
        referrerPolicy: "strict-origin",
      });
      if (response.status === 201) {
        draft = null;
        if (box.value === text) box.value = "";
        say("Sent to the thread.");
      } else {
        say(failure(response.status), "error");
      }
    } catch {
      say("Could not reach your Library. Try again.", "error");
    } finally {
      sending = false;
      send.disabled = false;
    }
  });
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      send.click();
    }
  });
})`;

/** The shell's policy: only its own nonce'd style and script, and frames from this host. */
export const shellContentSecurityPolicy = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** The page around a published page: title, the sandboxed frame and the reply box. */
export function renderPageShell(
  page: Pick<PreviewPage, "id" | "title" | "kind">,
  nonce: string,
): string {
  const raw = `/raw/${page.id}`;
  const config = {
    kind: page.kind,
    raw,
    replies: `/p/${page.id}/replies`,
    replyMax: PREVIEW_PAGE_REPLY_MAX,
    minHeight: DOSSIER_MIN_HEIGHT,
    maxHeight: DOSSIER_MAX_HEIGHT,
    ...(page.kind === "html" ? { fragments: THEME_FRAGMENTS, themes: THEME_MESSAGES } : {}),
  };
  const title = escapeHtml(page.title);
  // An html page's theme is in its address, so the script picks the address once it knows the
  // reader's color scheme; a dossier themes itself and can load straight away.
  const src = page.kind === "dossier" ? ` src="${raw}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style nonce="${nonce}">${SHELL_STYLE}</style>
</head>
<body class="kind-${page.kind}">
<header><h1>${title}</h1></header>
<main>
<iframe id="page" title="${title}"${src} sandbox="${RAW_PAGE_SANDBOX}" referrerpolicy="no-referrer"></iframe>
</main>
<form id="reply" novalidate>
<div class="reply">
<label for="reply-text">Reply to the thread</label>
<textarea id="reply-text" name="text" rows="3" maxlength="${PREVIEW_PAGE_REPLY_MAX}" placeholder="Write a reply for the agent"></textarea>
<div class="actions">
<p id="status" role="status" aria-live="polite"></p>
<button id="send" type="submit">Send to thread</button>
</div>
</div>
</form>
<script nonce="${nonce}">${SHELL_SCRIPT}(${scriptJson(config)});</script>
</body>
</html>
`;
}

/** Status pages carry no script and only their own inline style. */
export const STATUS_PAGE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

const statusPage = (title: string, body: string) => `<!doctype html>
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

export const pageEndedPage = statusPage(
  "This page has ended or expired",
  "Restore it or publish it again from Loom.",
);

export const pageUnavailablePage = statusPage(
  "This page could not load",
  "Your Library could not open it right now. Reload to try again.",
);
