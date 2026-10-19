import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { ThreadId } from "../baseSchemas.ts";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const PREVIEW_LINKS_FEATURE = "preview-links";

export const PREVIEW_LINKS_WS_METHODS = {
  watch: "loom.preview-links.watch",
  configure: "loom.preview-links.configure",
  share: "loom.preview-links.share",
  open: "loom.preview-links.open",
  extend: "loom.preview-links.extend",
  revoke: "loom.preview-links.revoke",
  restore: "loom.preview-links.restore",
  revokeAll: "loom.preview-links.revokeAll",
  signOutBrowsers: "loom.preview-links.signOutBrowsers",
} as const;

export const PREVIEW_LINK_LIFETIMES = ["1h", "12h", "24h"] as const;
export const PreviewLinkLifetime = Schema.Literals(PREVIEW_LINK_LIFETIMES);
export type PreviewLinkLifetime = typeof PreviewLinkLifetime.Type;

export const PREVIEW_LINK_LIFETIME_MS: Record<PreviewLinkLifetime, number> = {
  "1h": 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/** Ended links can be restored, keeping their address, for this long. */
export const PREVIEW_LINK_RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_PREVIEW_GATEWAY_PORT = 3779;

/**
 * Hosts are one label under the suffix, `<port>-<share>-<machine>.<suffix>`, because
 * Cloudflare's free certificate covers only the first level below the zone.
 */
export const PreviewLinkSuffix = Schema.String.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^(?=.{3,200}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
);

/** Kept short so `<port>-<share>-<machine>` stays within the 63 character label limit. */
export const PreviewMachineName = Schema.String.check(Schema.isPattern(/^[a-z0-9]{1,40}$/));

export const PreviewLinkPort = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

export const PreviewLinksSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** Registrable domain whose wildcard points at this computer's tunnel, such as `bagels.top`. */
  suffix: Schema.NullOr(PreviewLinkSuffix),
  machine: PreviewMachineName,
  defaultLifetime: PreviewLinkLifetime,
  /** Loopback port the tunnel forwards to. The tunnel's ingress must name the same port. */
  gatewayPort: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PREVIEW_GATEWAY_PORT)),
  ),
});
export type PreviewLinksSettings = typeof PreviewLinksSettings.Type;

export const PreviewLinkState = Schema.Literals(["open", "revoked", "expired"]);
export type PreviewLinkState = typeof PreviewLinkState.Type;

export const PreviewLink = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("port"),
  port: PreviewLinkPort,
  /** `5173-k3f9x2-dorothy.bagels.top`; a fresh share segment per link, kept on restore. */
  host: Schema.String,
  /** Canonical `https://<host>/`. It opens only in a browser that entered from Loom. */
  url: Schema.String,
  createdBy: Schema.Literals(["owner", "agent"]),
  threadId: Schema.NullOr(ThreadId),
  laneId: Schema.NullOr(Schema.String),
  state: PreviewLinkState,
  lifetime: PreviewLinkLifetime,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  restorableUntil: Schema.NullOr(Schema.String),
});
export type PreviewLink = typeof PreviewLink.Type;

export const PreviewTunnelState = Schema.Literals([
  "off",
  "needs-token",
  "starting",
  "connected",
  "error",
]);
export type PreviewTunnelState = typeof PreviewTunnelState.Type;

export const PreviewGatewayState = Schema.Literals(["off", "listening", "error"]);
export type PreviewGatewayState = typeof PreviewGatewayState.Type;

export const PreviewLinksSetup = Schema.Struct({
  settings: PreviewLinksSettings,
  tokenStored: Schema.Boolean,
  /** False until enabled with a suffix; links cannot be shared before then. */
  ready: Schema.Boolean,
  tunnel: Schema.Struct({ state: PreviewTunnelState, message: Schema.NullOr(Schema.String) }),
  gateway: Schema.Struct({ state: PreviewGatewayState, message: Schema.NullOr(Schema.String) }),
});
export type PreviewLinksSetup = typeof PreviewLinksSetup.Type;

/** Bounded: ended links are purged once they can no longer be restored. */
export const PreviewLinksSnapshot = Schema.Struct({
  setup: PreviewLinksSetup,
  links: Schema.Array(PreviewLink),
});
export type PreviewLinksSnapshot = typeof PreviewLinksSnapshot.Type;

export const PreviewLinksConfigureInput = Schema.Struct({
  settings: PreviewLinksSettings,
  /** Omit to keep the stored tunnel token, null to remove it. Never returned. */
  tunnelToken: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.isMinLength(20), Schema.isMaxLength(4096))),
  ),
});
export type PreviewLinksConfigureInput = typeof PreviewLinksConfigureInput.Type;

export const PreviewLinkShareInput = Schema.Struct({
  port: PreviewLinkPort,
  /** Defaults to the configured lifetime. An open link for the port is reused, not duplicated. */
  lifetime: Schema.optionalKey(PreviewLinkLifetime),
});
export type PreviewLinkShareInput = typeof PreviewLinkShareInput.Type;

export const PreviewLinkOpenInput = Schema.Struct({
  /** A link id, or any URL on a link's host such as an agent's canonical link. */
  link: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  /** Path, query and fragment to land on. Defaults to the URL's own, else `/`. */
  path: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
});
export type PreviewLinkOpenInput = typeof PreviewLinkOpenInput.Type;

export const PreviewLinkEntry = Schema.Struct({
  /** `https://<host>/__loom/enter?code=...`: single use, valid for 60 seconds. */
  url: Schema.String,
  link: PreviewLink,
});
export type PreviewLinkEntry = typeof PreviewLinkEntry.Type;

const LinkRef = Schema.Struct({ linkId: Schema.String });

export const PreviewLinkLifetimeInput = Schema.Struct({
  ...LinkRef.fields,
  lifetime: Schema.optionalKey(PreviewLinkLifetime),
});
export type PreviewLinkLifetimeInput = typeof PreviewLinkLifetimeInput.Type;

export const PreviewLinksErrorReason = Schema.Literals([
  "not-configured",
  "port-denied",
  "port-not-in-lane",
  "not-found",
  "not-restorable",
  "invalid",
  "storage",
  "tunnel",
]);
export type PreviewLinksErrorReason = typeof PreviewLinksErrorReason.Type;

export class PreviewLinksError extends Schema.TaggedError<PreviewLinksError>()(
  "PreviewLinksError",
  {
    reason: PreviewLinksErrorReason,
    message: Schema.String,
  },
) {}

const rpc = <const Tag extends string, Payload extends Schema.Top, Success extends Schema.Top>(
  tag: Tag,
  payload: Payload,
  success: Success,
) =>
  Rpc.make(tag, {
    payload,
    success,
    error: Schema.Union([PreviewLinksError, EnvironmentAuthorizationError]),
  });

export const PreviewLinksRpcGroup = RpcGroup.make(
  Rpc.make(PREVIEW_LINKS_WS_METHODS.watch, {
    payload: Schema.Struct({}),
    success: PreviewLinksSnapshot,
    error: Schema.Union([PreviewLinksError, EnvironmentAuthorizationError]),
    stream: true,
  }),
  rpc(PREVIEW_LINKS_WS_METHODS.configure, PreviewLinksConfigureInput, PreviewLinksSetup),
  rpc(PREVIEW_LINKS_WS_METHODS.share, PreviewLinkShareInput, PreviewLink),
  rpc(PREVIEW_LINKS_WS_METHODS.open, PreviewLinkOpenInput, PreviewLinkEntry),
  rpc(PREVIEW_LINKS_WS_METHODS.extend, PreviewLinkLifetimeInput, PreviewLink),
  rpc(PREVIEW_LINKS_WS_METHODS.revoke, LinkRef, PreviewLink),
  rpc(PREVIEW_LINKS_WS_METHODS.restore, PreviewLinkLifetimeInput, PreviewLink),
  rpc(PREVIEW_LINKS_WS_METHODS.revokeAll, Schema.Struct({}), Schema.Void),
  rpc(PREVIEW_LINKS_WS_METHODS.signOutBrowsers, Schema.Struct({}), Schema.Void),
);

const LINK_LABEL = /^(\d{1,5})-([a-z0-9]{6})-([a-z0-9]{1,40})$/;

/**
 * Splits a preview host into its port, share segment and machine, or null when the host is
 * not exactly one label under `suffix`. Shared by the gateway and by clients that recognize
 * an agent's link in a message.
 */
export function parsePreviewLinkHost(
  host: string,
  suffix: string,
): { readonly port: number; readonly share: string; readonly machine: string } | null {
  const normalized = host.toLowerCase();
  const tail = `.${suffix.toLowerCase()}`;
  if (!normalized.endsWith(tail)) return null;
  const label = normalized.slice(0, -tail.length);
  if (label.length === 0 || label.length > 63 || label.includes(".")) return null;
  const match = LINK_LABEL.exec(label);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, share: match[2]!, machine: match[3]! };
}

/** True when `url` looks like a preview link on some suffix, before knowing which computer owns it. */
export function looksLikePreviewLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const dot = parsed.hostname.indexOf(".");
    return dot > 0 && LINK_LABEL.test(parsed.hostname.slice(0, dot));
  } catch {
    return false;
  }
}

/** Every gateway page, the single-use entry included, lives under this path on a link's host. */
export const PREVIEW_LINK_GATEWAY_PATH = "/__loom/";

/**
 * True for a page a link serves. It opens nowhere until the browser has entered from Loom, so a
 * client opening it outside Loom swaps it for a fresh entry. Gateway pages open as they are.
 */
export function needsPreviewLinkEntry(url: string): boolean {
  return (
    looksLikePreviewLinkUrl(url) && !new URL(url).pathname.startsWith(PREVIEW_LINK_GATEWAY_PATH)
  );
}
