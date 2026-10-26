// @effect-diagnostics nodeBuiltinImport:off - cookie HMACs and entry codes run synchronously on the gateway's request path.
import * as NodeCrypto from "node:crypto";
import type { ServerAuthSessionMethod } from "@t3tools/contracts";
import {
  DEFAULT_PREVIEW_GATEWAY_PORT,
  PREVIEW_LINK_LIFETIME_MS,
  PREVIEW_LINK_RESTORE_WINDOW_MS,
  type LibraryPreviewAccess,
  type PreviewLink,
  type PreviewLinksSettings,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import { PORT_BLOCK } from "../project-lifecycle/policy.ts";
import { previewTicketPublicKey } from "./ticket.ts";
import { PREVIEW_ENTRY_PATH, PREVIEW_RESERVED_PATH, type PreviewLibraryAccess } from "./types.ts";

/**
 * SSH, databases, debuggers, Loom's own default ports and Switchboard's (8317-8318 local, 8321-8322
 * network gateways). Ports below 1024 are denied too.
 */
export const DENIED_PREVIEW_PORTS: ReadonlySet<number> = new Set([
  22, 3306, 3773, 3779, 5432, 6379, 8317, 8318, 8321, 8322, 9222, 9229, 27017,
]);

export const PREVIEW_ENTRY_CODE_TTL_MS = 60_000;
export const PREVIEW_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const COOKIE_VALUE_MAX_LENGTH = 4096;
const SHARE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SHARE_LENGTH = 6;

/** `ownPorts` are listeners this server knows it runs: its own port, the dev web port, the gateway and cloudflared metrics. */
export function isPreviewPortDenied(
  port: number,
  ownPorts: Iterable<number | null | undefined>,
): boolean {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return true;
  if (DENIED_PREVIEW_PORTS.has(port)) return true;
  for (const own of ownPorts) if (own === port) return true;
  return false;
}

export function isLanePort(port: number, portBase: number | null): boolean {
  return portBase !== null && port >= portBase && port < portBase + PORT_BLOCK;
}

/**
 * Dev servers listen from 13773 up, one per worktree, so each takes the gateway port this far
 * above its own. That keeps them off the installed app's 3779 and off each other.
 */
const DEV_GATEWAY_PORT_OFFSET = 10_000;

/** The gateway port before settings are saved. Saved settings keep whatever port they hold. */
export function defaultPreviewGatewayPort(devServerPort: number | null): number {
  if (devServerPort === null) return DEFAULT_PREVIEW_GATEWAY_PORT;
  const above = devServerPort + DEV_GATEWAY_PORT_OFFSET;
  return above <= 65535 ? above : devServerPort - DEV_GATEWAY_PORT_OFFSET;
}

/** `Dorothy.local` becomes `dorothy`. Falls back to `loom` when nothing usable is left. */
export function previewMachineSlug(hostname: string): string {
  const first = hostname.trim().toLowerCase().split(".")[0] ?? "";
  const slug = first.replace(/[^a-z0-9]/g, "").slice(0, 40);
  return slug.length > 0 ? slug : "loom";
}

export function isPreviewReady(settings: PreviewLinksSettings): boolean {
  return settings.enabled && settings.suffix !== null;
}

export function randomShareSegment(): string {
  let share = "";
  while (share.length < SHARE_LENGTH) {
    for (const byte of NodeCrypto.randomBytes(SHARE_LENGTH * 2)) {
      // 252 is the largest multiple of 36 below 256, so every character is equally likely.
      if (byte < 252 && share.length < SHARE_LENGTH) share += SHARE_ALPHABET[byte % 36];
    }
  }
  return share;
}

export function formatPreviewHost(input: {
  readonly port: number;
  readonly share: string;
  readonly machine: string;
  readonly suffix: string;
}): string {
  return `${input.port}-${input.share}-${input.machine}.${input.suffix}`;
}

export function randomPreviewLinkId(): string {
  return NodeCrypto.randomUUID();
}

export function randomCookieKey(): Uint8Array {
  return new Uint8Array(NodeCrypto.randomBytes(32));
}

export function randomEntryCode(): string {
  return NodeCrypto.randomBytes(16).toString("base64url");
}

export function previewEntryUrl(host: string, code: string): string {
  return `https://${host}${PREVIEW_ENTRY_PATH}?code=${encodeURIComponent(code)}`;
}

/**
 * The landing path after entry. It becomes a `Location` header, so anything that could leave
 * the host or break the header falls back to `/`; other non-ASCII characters are escaped.
 */
export function sanitizeEntryPath(path: string | undefined): string {
  if (path === undefined || path.length === 0 || path.length > 4096) return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  // Landing on the gateway's own paths would replay the entry or show its pages instead of the app.
  if (path.startsWith(PREVIEW_RESERVED_PATH)) return "/";
  if (/[\u0000-\u001f\u007f-\u009f]/.test(path)) return "/";
  try {
    return path.replace(/[^!-~]/gu, (character) => encodeURIComponent(character));
  } catch {
    return "/";
  }
}

/** The host of a link URL such as an agent's canonical link, or null for anything else. */
export function previewReferenceUrl(reference: string): URL | null {
  if (!/^https?:\/\//i.test(reference)) return null;
  try {
    return new URL(reference);
  } catch {
    return null;
  }
}

/**
 * What a preview cookie's access stands on. Usually the Loom session that opened the link. A DPoP
 * client, such as the mobile app or remote web over T3 Connect, replaces its one-hour session
 * with a new one, so its cookies follow every DPoP session of the same subject instead.
 */
export function previewAccessKey(session: {
  readonly sessionId: string;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
}): string {
  return session.method === "dpop-access-token" ? `dpop:${session.subject}` : session.sessionId;
}

interface PreviewCookieClaims {
  readonly v: 2;
  readonly sub: string;
  /** See `previewAccessKey`. */
  readonly key: string;
  readonly host: string;
  /** Unix milliseconds, so a removal can keep out every cookie minted up to that moment. */
  readonly iat: number;
  /** Unix seconds. */
  readonly exp: number;
}

const hmac = (key: Uint8Array, payload: string) =>
  NodeCrypto.createHmac("sha256", key).update(payload).digest();

export function signPreviewCookie(claims: Omit<PreviewCookieClaims, "v">, key: Uint8Array): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 2,
      sub: claims.sub,
      key: claims.key,
      host: claims.host,
      iat: claims.iat,
      exp: claims.exp,
    }),
  ).toString("base64url");
  return `${payload}.${hmac(key, payload).toString("base64url")}`;
}

export function verifyPreviewCookie(
  value: string,
  key: Uint8Array,
  host: string,
  nowMs: number,
): { readonly key: string; readonly sub: string; readonly issuedAtMs: number } | null {
  if (value.length === 0 || value.length > COOKIE_VALUE_MAX_LENGTH) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return null;
  const payload = value.slice(0, dot);
  const signature = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = hmac(key, payload);
  if (signature.length !== expected.length || !NodeCrypto.timingSafeEqual(signature, expected))
    return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const { v, sub, key: accessKey, host: claimedHost, iat, exp } = claims as Record<string, unknown>;
  if (v !== 2 || typeof sub !== "string" || typeof accessKey !== "string") return null;
  if (typeof iat !== "number") return null;
  if (claimedHost !== host || typeof exp !== "number" || exp * 1000 <= nowMs) return null;
  return { key: accessKey, sub, issuedAtMs: iat };
}

/** A Library this computer sends cold browsers to, and the key its tickets must carry. */
export interface PreviewTicketIssuer extends PreviewLibraryAccess {
  /** Exactly as the Library writes it in a ticket's `iss`. */
  readonly issuer: string;
  readonly keyId: string;
  readonly publicKey: NodeCrypto.KeyObject;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Pasted into a link after the origin, so it may not start a new authority, query or fragment.
const TICKET_PATH_PATTERN = /^\/(?!\/)[A-Za-z0-9._~%!$&'()*+,;=:@/-]*$/;
/**
 * The Library sends a browser that is not signed in there to its login with this request as the
 * way back, and quietly drops a way back longer than 2048 characters.
 */
const MAX_SIGN_IN_TARGET_LENGTH = 1800;

/** Null unless the Library's answer is safe to link browsers to and names a usable key. */
export function parseLibraryPreviewAccess(
  access: LibraryPreviewAccess,
): PreviewTicketIssuer | null {
  const publicKey = previewTicketPublicKey(access.publicKey);
  if (publicKey === null || access.keyId.length === 0) return null;
  if (!TICKET_PATH_PATTERN.test(access.ticketPath)) return null;
  let url: URL;
  try {
    url = new URL(access.origin);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    return null;
  }
  return {
    issuer: access.origin,
    origin: url.origin,
    ticketPath: access.ticketPath,
    keyId: access.keyId,
    publicKey,
  };
}

/** The Library address that signs this browser in and sends it back to `requestPath`. */
export function previewSignInUrl(
  access: PreviewLibraryAccess,
  host: string,
  nonce: string,
  requestPath: string,
): string {
  const target = (path: string) =>
    `${access.ticketPath}?${new URLSearchParams({ host, nonce, path }).toString()}`;
  const deep = target(sanitizeEntryPath(requestPath));
  return `${access.origin}${deep.length <= MAX_SIGN_IN_TARGET_LENGTH ? deep : target("/")}`;
}

const ms = (iso: string | null) => (iso === null ? null : Date.parse(iso));

export const isoAt = (epochMs: number): string => DateTime.formatIso(DateTime.makeUnsafe(epochMs));

/** The next time a link expires or an ended link is purged, or null when nothing is pending. */
export function nextPreviewDeadline(links: ReadonlyArray<PreviewLink>): number | null {
  let next: number | null = null;
  for (const link of links) {
    const at = link.state === "open" ? ms(link.expiresAt) : ms(link.restorableUntil);
    if (at !== null && Number.isFinite(at) && (next === null || at < next)) next = at;
  }
  return next;
}

export function endPreviewLink(
  link: PreviewLink,
  state: "revoked" | "expired",
  endedAtMs: number,
): PreviewLink {
  return {
    ...link,
    state,
    endedAt: isoAt(endedAtMs),
    restorableUntil: isoAt(endedAtMs + PREVIEW_LINK_RESTORE_WINDOW_MS),
  };
}

/**
 * Expires open links past their lifetime, dating the end at `expiresAt` so a server that was
 * down does not stretch the restore window, and drops ended links that can no longer be restored.
 */
export function sweepPreviewLinks(
  links: ReadonlyArray<PreviewLink>,
  nowMs: number,
): { readonly links: ReadonlyArray<PreviewLink>; readonly changed: boolean } {
  let changed = false;
  const next: PreviewLink[] = [];
  for (const link of links) {
    if (link.state === "open") {
      const expiresAt = Date.parse(link.expiresAt);
      if (expiresAt <= nowMs) {
        changed = true;
        const ended = endPreviewLink(link, "expired", expiresAt);
        if (Date.parse(ended.restorableUntil ?? "") > nowMs) next.push(ended);
        continue;
      }
      next.push(link);
      continue;
    }
    const until = ms(link.restorableUntil);
    if (until === null || !(until > nowMs)) {
      changed = true;
      continue;
    }
    next.push(link);
  }
  return { links: changed ? next : links, changed };
}

export function previewExpiry(nowMs: number, lifetime: PreviewLink["lifetime"]): string {
  return isoAt(nowMs + PREVIEW_LINK_LIFETIME_MS[lifetime]);
}
