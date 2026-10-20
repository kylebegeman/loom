import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { PREVIEW_LINK_GATEWAY_PATH } from "@t3tools/contracts/fork";

/**
 * The gateway's only view of link state. It is synchronous because it runs on every proxied
 * request; the service keeps it current in memory and the gateway never touches storage.
 */
export interface PreviewGatewayView {
  /** `host` is already normalized by `normalizeRequestHost`. */
  readonly route: (host: string) => PreviewGatewayRoute;
  /** Consumes a single-use entry code minted for this host. */
  readonly redeem: (host: string, code: string) => PreviewGatewayEntry | null;
  /** Checks a `__Host-loom_pv` value: signature, expiry, host and that its Loom session is still live. */
  readonly authorize: (host: string, cookieValue: string) => PreviewGatewaySession | null;
  /** Re-checked per request because the denylist follows the server's own listeners. */
  readonly portAllowed: (port: number) => boolean;
  /** Where a browser without a cookie can sign in, or null while no Library has said. */
  readonly libraryAccess: () => PreviewLibraryAccess | null;
  /**
   * Trades a Library ticket for a cookie. `nonce` is the browser's nonce cookie; the ticket and
   * the nonce each work once.
   */
  readonly redeemTicket: (
    host: string,
    ticket: string,
    nonce: string,
    path: string,
  ) => PreviewGatewayEntry | null;
}

export interface PreviewLibraryAccess {
  /** Such as `https://loom.begam.in`, with no trailing slash. */
  readonly origin: string;
  /** Starts with a single `/`, with no query or fragment. */
  readonly ticketPath: string;
}

export type PreviewGatewayRoute =
  | { readonly _tag: "Link"; readonly linkId: string; readonly port: number }
  /** One label under the suffix for this machine, with no open link: unknown, expired or revoked. */
  | { readonly _tag: "Ended" }
  /** Not a preview host for this machine at all. */
  | { readonly _tag: "Foreign" };

export interface PreviewGatewayEntry {
  readonly cookieValue: string;
  readonly maxAgeSeconds: number;
  /** Path, query and fragment to redirect to. Always starts with a single `/`. */
  readonly path: string;
}

export interface PreviewGatewaySession {
  /** See `previewAccessKey`. */
  readonly key: string;
  readonly sub: string;
}

export interface PreviewGatewayHandle {
  readonly port: number;
  /** Ends running requests and upgrades, such as event streams and HMR sockets, that lost access. */
  readonly destroyConnections: (
    match: (connection: { readonly host: string; readonly key: string }) => boolean,
  ) => void;
}

export class PreviewGatewayListenError {
  readonly _tag = "PreviewGatewayListenError";
  readonly port: number;
  readonly message: string;
  constructor(port: number, message: string) {
    this.port = port;
    this.message = message;
  }
}

export type StartPreviewGateway = (options: {
  readonly port: number;
  readonly view: PreviewGatewayView;
}) => Effect.Effect<PreviewGatewayHandle, PreviewGatewayListenError, Scope.Scope>;

export class PreviewFolderListenError {
  readonly _tag = "PreviewFolderListenError";
  readonly port: number;
  readonly message: string;
  constructor(port: number, message: string) {
    this.port = port;
    this.message = message;
  }
}

export interface PreviewFolderServer {
  readonly port: number;
}

/**
 * Serves `root`, already a realpath, read-only on 127.0.0.1 until the scope closes. It runs in
 * Loom's own process, so releasing the lane never signals it; only the link ending stops it.
 */
export type ServePreviewFolder = (options: {
  readonly root: string;
  readonly port: number;
}) => Effect.Effect<PreviewFolderServer, PreviewFolderListenError, Scope.Scope>;

export interface PreviewTunnelStatus {
  readonly state: "starting" | "connected" | "error";
  /** Human-readable cause or progress. Never contains the token. */
  readonly message: string | null;
  /** cloudflared's metrics listener, denied to links while known. */
  readonly metricsPort: number | null;
}

/**
 * `tunnel.ts` exports `runPreviewTunnel(options)`. It resolves or installs cloudflared, runs
 * `tunnel run` with the token in the child's env, restarts with backoff and never completes; the
 * caller interrupts it to stop the connector.
 */
export interface RunPreviewTunnelOptions {
  readonly token: string;
  readonly onStatus: (status: PreviewTunnelStatus) => Effect.Effect<void>;
}

export const PREVIEW_COOKIE_NAME = "__Host-loom_pv";

/** Every gateway-owned path lives under this prefix on every preview host. */
export const PREVIEW_RESERVED_PATH = PREVIEW_LINK_GATEWAY_PATH;

export const PREVIEW_ENTRY_PATH = `${PREVIEW_LINK_GATEWAY_PATH}enter`;

/** Lowercases the Host header and drops its port; null when it is missing or malformed. */
export function normalizeRequestHost(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 253 || host.startsWith("[")) return null;
  const colon = host.indexOf(":");
  const name = colon === -1 ? host : host.slice(0, colon);
  if (colon !== -1 && !/^\d{1,5}$/.test(host.slice(colon + 1))) return null;
  return /^[a-z0-9.-]+$/.test(name) ? name : null;
}

export function formatPreviewSetCookie(value: string, maxAgeSeconds: number): string {
  return `${PREVIEW_COOKIE_NAME}=${value}; Max-Age=${maxAgeSeconds}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
