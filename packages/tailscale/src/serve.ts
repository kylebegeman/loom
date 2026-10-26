import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import {
  buildTailscaleHttpsBaseUrl,
  disableTailscaleServe,
  ensureTailscaleServe,
  readTailscaleServeStatusJson,
  readTailscaleStatus,
  TailscaleStatusParseError,
  type TailscaleCommandError,
} from "./tailscale.ts";

/** Lives in the server state directory, which the desktop app shares with its backend. */
export const TAILSCALE_SERVE_CLAIMS_FILE = "tailscale-serve.json";

export interface TailscaleServeHandler {
  readonly mount: string;
  /** `null` for file, text, and redirect handlers. */
  readonly proxy: string | null;
}

export interface TailscaleServePort {
  readonly tcpForward: string | null;
  readonly handlers: ReadonlyArray<TailscaleServeHandler>;
}

export interface TailscaleServeConfig {
  readonly ports: ReadonlyMap<number, TailscaleServePort>;
  /** Loom only runs `serve --bg`, so a foreground session is always someone else's. */
  readonly foregroundPorts: ReadonlySet<number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePort = (value: string): number | null => {
  if (!/^\d{1,5}$/u.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : null;
};

const portOfHostPort = (hostPort: string): number | null => {
  const separator = hostPort.lastIndexOf(":");
  return separator < 0 ? null : parsePort(hostPort.slice(separator + 1));
};

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * Reads the shape `tailscale serve status --json` prints: `TCP` keyed by port,
 * `Web` keyed by `host:port` with `Handlers` keyed by mount, and `Foreground`
 * holding one nested config per foreground session.
 */
export const parseTailscaleServeConfig = (
  rawJson: string,
): Effect.Effect<TailscaleServeConfig, TailscaleStatusParseError> =>
  decodeJson(rawJson.trim().length === 0 ? "{}" : rawJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.flatMap((parsed) => {
      if (!isRecord(parsed)) {
        return Effect.fail(
          new TailscaleStatusParseError({ cause: new Error("serve status is not an object") }),
        );
      }
      const ports = new Map<
        number,
        { tcpForward: string | null; handlers: TailscaleServeHandler[] }
      >();
      const portEntry = (port: number) => {
        const existing = ports.get(port);
        if (existing) return existing;
        const created = {
          tcpForward: null as string | null,
          handlers: [] as TailscaleServeHandler[],
        };
        ports.set(port, created);
        return created;
      };
      if (isRecord(parsed.TCP)) {
        for (const [key, handler] of Object.entries(parsed.TCP)) {
          const port = parsePort(key);
          if (port === null) continue;
          const entry = portEntry(port);
          if (isRecord(handler) && typeof handler.TCPForward === "string" && handler.TCPForward) {
            entry.tcpForward = handler.TCPForward;
          }
        }
      }
      if (isRecord(parsed.Web)) {
        for (const [hostPort, server] of Object.entries(parsed.Web)) {
          const port = portOfHostPort(hostPort);
          if (port === null) continue;
          const entry = portEntry(port);
          if (!isRecord(server) || !isRecord(server.Handlers)) continue;
          for (const [mount, handler] of Object.entries(server.Handlers)) {
            entry.handlers.push({
              mount,
              proxy: isRecord(handler) && typeof handler.Proxy === "string" ? handler.Proxy : null,
            });
          }
        }
      }
      const foregroundPorts = new Set<number>();
      if (isRecord(parsed.Foreground)) {
        for (const session of Object.values(parsed.Foreground)) {
          if (!isRecord(session)) continue;
          for (const key of isRecord(session.TCP) ? Object.keys(session.TCP) : []) {
            const port = parsePort(key);
            if (port !== null) foregroundPorts.add(port);
          }
          for (const hostPort of isRecord(session.Web) ? Object.keys(session.Web) : []) {
            const port = portOfHostPort(hostPort);
            if (port !== null) foregroundPorts.add(port);
          }
        }
      }
      return Effect.succeed({ ports, foregroundPorts } satisfies TailscaleServeConfig);
    }),
  );

/**
 * The CLI rewrites targets (`[::1]` loses its brackets, a trailing slash may
 * appear), so compare scheme, host, port, and path rather than raw strings.
 */
const normalizeServeTarget = (value: string): string => {
  const match = /^([a-z][a-z\d+.-]*):\/\/([^/]*)(\/.*)?$/iu.exec(value.trim());
  if (!match) return value.trim().replace(/\/+$/u, "");
  const [, scheme = "", authority = "", path = ""] = match;
  const portSeparator = authority.lastIndexOf(":");
  const hasPort = portSeparator >= 0 && /^\d+$/u.test(authority.slice(portSeparator + 1));
  const host = (hasPort ? authority.slice(0, portSeparator) : authority).replace(/^\[|\]$/gu, "");
  const port = hasPort ? `:${String(Number(authority.slice(portSeparator + 1)))}` : "";
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${port}${path.replace(/\/+$/u, "")}`;
};

const sameServeTarget = (left: string, right: string): boolean =>
  normalizeServeTarget(left) === normalizeServeTarget(right);

export type TailscaleServeClaimDecision =
  | { readonly _tag: "Free" }
  | { readonly _tag: "Ours"; readonly current: boolean }
  | { readonly _tag: "HeldByOther"; readonly holder: string }
  | { readonly _tag: "TcpForward"; readonly holder: string }
  | { readonly _tag: "OtherMounts"; readonly mounts: ReadonlyArray<string> };

interface OwnershipInput {
  readonly config: TailscaleServeConfig;
  readonly servePort: number;
  /** The loopback URL this server answers on now. */
  readonly target: string;
  /** What Loom last recorded for this port, which survives a crash or a port change. */
  readonly recordedTarget: string | null;
}

const isOwnTarget = (proxy: string | null, input: OwnershipInput): boolean =>
  proxy !== null &&
  (sameServeTarget(proxy, input.target) ||
    (input.recordedTarget !== null && sameServeTarget(proxy, input.recordedTarget)));

export const decideTailscaleServeClaim = (input: OwnershipInput): TailscaleServeClaimDecision => {
  if (input.config.foregroundPorts.has(input.servePort)) {
    return { _tag: "HeldByOther", holder: "a foreground `tailscale serve` session" };
  }
  const port = input.config.ports.get(input.servePort);
  if (port === undefined) return { _tag: "Free" };
  if (port.tcpForward !== null) return { _tag: "TcpForward", holder: port.tcpForward };
  const root = port.handlers.find((handler) => handler.mount === "/");
  if (root !== undefined && !isOwnTarget(root.proxy, input)) {
    return { _tag: "HeldByOther", holder: root.proxy ?? "a file, text, or redirect handler" };
  }
  const otherMounts = port.handlers
    .filter((handler) => handler.mount !== "/")
    .map((handler) => handler.mount);
  if (otherMounts.length > 0) return { _tag: "OtherMounts", mounts: otherMounts };
  if (root === undefined) {
    // A port entry with no handlers is not something Loom ever leaves behind.
    return { _tag: "HeldByOther", holder: "an unrecognized Tailscale Serve configuration" };
  }
  return {
    _tag: "Ours",
    current: root.proxy !== null && sameServeTarget(root.proxy, input.target),
  };
};

/**
 * Only the `/` mount, and only while it proxies to this server now. A recorded
 * target is not enough here: the record is shared by every Loom process on
 * this state directory, and the one that wrote it last owns the mapping.
 */
export const decideTailscaleServeRelease = (
  input: Pick<OwnershipInput, "config" | "servePort" | "target">,
): boolean => {
  const root = input.config.ports
    .get(input.servePort)
    ?.handlers.find((handler) => handler.mount === "/");
  return root?.proxy != null && sameServeTarget(root.proxy, input.target);
};

export interface TailscaleServePortHolder {
  readonly port: number;
  readonly holder: string;
}

const describeDecision = (decision: TailscaleServeClaimDecision): string | null => {
  switch (decision._tag) {
    case "Free":
    case "Ours":
      return null;
    case "HeldByOther":
      return decision.holder;
    case "TcpForward":
      return `a TCP forward to ${decision.holder}`;
    case "OtherMounts":
      return `paths ${decision.mounts.join(", ")}`;
  }
};

/** Every port Loom must not claim, with what holds it. */
const tailscaleServePortsHeldByOthers = (input: {
  readonly config: TailscaleServeConfig;
  readonly target: string;
  readonly claims: TailscaleServeClaims;
}): ReadonlyArray<TailscaleServePortHolder> =>
  [...new Set([...input.config.ports.keys(), ...input.config.foregroundPorts])]
    .toSorted((left, right) => left - right)
    .flatMap((port) => {
      const holder = describeDecision(
        decideTailscaleServeClaim({
          config: input.config,
          servePort: port,
          target: input.target,
          recordedTarget: input.claims.get(port) ?? null,
        }),
      );
      return holder === null ? [] : [{ port, holder }];
    });

export type TailscaleServeClaims = ReadonlyMap<number, string>;

const TailscaleServeClaimsJson = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    claims: Schema.Record(Schema.String, Schema.String),
  }),
);
const decodeClaims = Schema.decodeEffect(TailscaleServeClaimsJson);
const encodeClaims = Schema.encodeEffect(TailscaleServeClaimsJson);

/** A missing or unreadable record means no claims, so ownership fails closed. */
const readTailscaleServeClaims = Effect.fn("tailscale.readTailscaleServeClaims")(
  function* (claimsPath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(claimsPath);
    const decoded = yield* decodeClaims(raw);
    const claims = new Map<number, string>();
    for (const [key, target] of Object.entries(decoded.claims)) {
      const port = parsePort(key);
      if (port !== null) claims.set(port, target);
    }
    return claims as TailscaleServeClaims;
  },
  Effect.orElseSucceed((): TailscaleServeClaims => new Map()),
);

export class TailscaleServeClaimRecordError extends Schema.TaggedError<TailscaleServeClaimRecordError>()(
  "TailscaleServeClaimRecordError",
  { servePort: Schema.Number, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not record Loom's Tailscale Serve claim for HTTPS port ${String(this.servePort)}.`;
  }
}

const writeTailscaleServeClaim = Effect.fn("tailscale.writeTailscaleServeClaim")(function* (input: {
  readonly claimsPath: string;
  readonly servePort: number;
  readonly target: string;
  readonly remove?: boolean;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const claims = new Map(yield* readTailscaleServeClaims(input.claimsPath));
  const recorded = claims.get(input.servePort);
  if (input.remove === true) {
    if (recorded === undefined || !sameServeTarget(recorded, input.target)) return;
    claims.delete(input.servePort);
  } else {
    if (recorded === input.target) return;
    claims.set(input.servePort, input.target);
  }
  const tempPath = `${input.claimsPath}.tmp`;
  yield* encodeClaims({
    version: 1,
    claims: Object.fromEntries([...claims].map(([port, target]) => [String(port), target])),
  }).pipe(
    Effect.flatMap((encoded) => fileSystem.writeFileString(tempPath, `${encoded}\n`)),
    Effect.flatMap(() => fileSystem.rename(tempPath, input.claimsPath)),
    Effect.mapError(
      (cause) => new TailscaleServeClaimRecordError({ servePort: input.servePort, cause }),
    ),
  );
});

const freePortHint = (servePort: number): string =>
  `Choose another port, or if you no longer need it, free the port with \`tailscale serve --https=${String(servePort)} --set-path=/ off\`.`;

export class TailscaleServeNotLoggedInError extends Schema.TaggedError<TailscaleServeNotLoggedInError>()(
  "TailscaleServeNotLoggedInError",
  {},
) {
  override get message(): string {
    return "Tailscale is not logged in on this machine. Log in to Tailscale, then try again.";
  }
}

export class TailscaleServeHttpsDisabledError extends Schema.TaggedError<TailscaleServeHttpsDisabledError>()(
  "TailscaleServeHttpsDisabledError",
  {},
) {
  override get message(): string {
    return "HTTPS certificates are off for this tailnet. Turn them on at https://login.tailscale.com/admin/dns, then try again.";
  }
}

export class TailscaleServePortHeldError extends Schema.TaggedError<TailscaleServePortHeldError>()(
  "TailscaleServePortHeldError",
  { servePort: Schema.Number, holder: Schema.String },
) {
  override get message(): string {
    return `HTTPS port ${String(this.servePort)} on the tailnet already serves ${this.holder}. Loom does not replace another app's mapping. ${freePortHint(this.servePort)}`;
  }
}

export class TailscaleServePortTcpForwardError extends Schema.TaggedError<TailscaleServePortTcpForwardError>()(
  "TailscaleServePortTcpForwardError",
  { servePort: Schema.Number, holder: Schema.String },
) {
  override get message(): string {
    return `Port ${String(this.servePort)} on the tailnet forwards raw TCP to ${this.holder}. Choose another port.`;
  }
}

export class TailscaleServeOtherMountsError extends Schema.TaggedError<TailscaleServeOtherMountsError>()(
  "TailscaleServeOtherMountsError",
  { servePort: Schema.Number, mounts: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `HTTPS port ${String(this.servePort)} on the tailnet already serves other paths (${this.mounts.join(", ")}). Choose another port.`;
  }
}

export type TailscaleServeClaimError =
  | TailscaleCommandError
  | TailscaleStatusParseError
  | TailscaleServeNotLoggedInError
  | TailscaleServeHttpsDisabledError
  | TailscaleServePortHeldError
  | TailscaleServePortTcpForwardError
  | TailscaleServeOtherMountsError
  | TailscaleServeClaimRecordError;

export interface TailscaleServeTarget {
  readonly claimsPath: string;
  readonly servePort: number;
  readonly localPort: number;
  /** URL-ready loopback host; defaults to 127.0.0.1. */
  readonly localHost?: string;
}

const tailscaleServeTargetUrl = (input: {
  readonly localPort: number;
  readonly localHost?: string;
}): string => `http://${input.localHost ?? "127.0.0.1"}:${String(input.localPort)}`;

const readServeConfig = readTailscaleServeStatusJson.pipe(
  Effect.flatMap(parseTailscaleServeConfig),
);

const assessTailscaleServe = Effect.fn("tailscale.assessTailscaleServe")(function* (input: {
  readonly claimsPath: string;
  readonly servePort: number;
  readonly target: string;
}) {
  const status = yield* readTailscaleStatus;
  if (status.loggedIn === false || status.magicDnsName === null) {
    return yield* new TailscaleServeNotLoggedInError();
  }
  // Without the capability `tailscale serve` blocks on an enablement URL until it times out.
  if (status.httpsServeEnabled === false) {
    return yield* new TailscaleServeHttpsDisabledError();
  }
  const config = yield* readServeConfig;
  const claims = yield* readTailscaleServeClaims(input.claimsPath);
  return { magicDnsName: status.magicDnsName, config, claims };
});

export interface TailscaleServeClaim {
  readonly baseUrl: string;
  readonly target: string;
  /** False when the mapping already pointed here. */
  readonly changed: boolean;
}

/**
 * Points `/` on the serve port at this server, but only when the port is free
 * or its `/` already proxies to Loom (now, or as recorded before a crash).
 * Another app's mapping is never replaced.
 */
export const claimTailscaleServe = Effect.fn("tailscale.claimTailscaleServe")(function* (
  input: TailscaleServeTarget,
) {
  const target = tailscaleServeTargetUrl(input);
  const assessed = yield* assessTailscaleServe({ ...input, target });
  const decision = decideTailscaleServeClaim({
    config: assessed.config,
    servePort: input.servePort,
    target,
    recordedTarget: assessed.claims.get(input.servePort) ?? null,
  });
  switch (decision._tag) {
    case "HeldByOther":
      return yield* new TailscaleServePortHeldError({
        servePort: input.servePort,
        holder: decision.holder,
      });
    case "TcpForward":
      return yield* new TailscaleServePortTcpForwardError({
        servePort: input.servePort,
        holder: decision.holder,
      });
    case "OtherMounts":
      return yield* new TailscaleServeOtherMountsError({
        servePort: input.servePort,
        mounts: decision.mounts,
      });
    case "Free":
    case "Ours":
      break;
  }
  // Record before mapping, so a crash in between still leaves a mapping Loom recognizes.
  yield* writeTailscaleServeClaim({
    claimsPath: input.claimsPath,
    servePort: input.servePort,
    target,
  });
  const changed = decision._tag === "Free" || !decision.current;
  if (changed) {
    yield* ensureTailscaleServe({
      localPort: input.localPort,
      servePort: input.servePort,
      ...(input.localHost !== undefined ? { localHost: input.localHost } : {}),
    });
  }
  return {
    baseUrl: buildTailscaleHttpsBaseUrl({
      magicDnsName: assessed.magicDnsName,
      servePort: input.servePort,
    }),
    target,
    changed,
  } satisfies TailscaleServeClaim;
});

/**
 * Removes this server's `/` mount if it still proxies here, and nothing else.
 * Returns whether a mapping was removed.
 */
export const releaseTailscaleServe = Effect.fn("tailscale.releaseTailscaleServe")(function* (
  input: TailscaleServeTarget,
) {
  const target = tailscaleServeTargetUrl(input);
  const config = yield* readServeConfig;
  const ours = decideTailscaleServeRelease({ config, servePort: input.servePort, target });
  if (ours) {
    yield* disableTailscaleServe({ servePort: input.servePort }).pipe(
      Effect.catchTags({
        TailscaleCommandExitError: (error) =>
          error.stderrDiagnostic === "no-existing-handler" ? Effect.void : Effect.fail(error),
      }),
    );
  }
  yield* writeTailscaleServeClaim({
    claimsPath: input.claimsPath,
    servePort: input.servePort,
    target,
    remove: true,
  });
  return ours;
});

export const TailscaleServeState = Schema.Literals([
  "configured",
  "not-configured",
  "port-held",
  "tcp-forward",
  "other-mounts",
  "https-disabled",
  "not-logged-in",
  "cli-unavailable",
  "failed",
]);
export type TailscaleServeState = typeof TailscaleServeState.Type;

export interface TailscaleServeInspection {
  readonly state: TailscaleServeState;
  readonly magicDnsName: string | null;
  /** What holds the serve port when it is not Loom's. */
  readonly holder: string | null;
  readonly heldPorts: ReadonlyArray<TailscaleServePortHolder>;
}

const inspectionFailure = (
  state: TailscaleServeState,
  magicDnsName: string | null = null,
): TailscaleServeInspection => ({ state, magicDnsName, holder: null, heldPorts: [] });

/** The claim decision as a state for display. Never fails. */
export const inspectTailscaleServe = Effect.fn("tailscale.inspectTailscaleServe")(function* (
  input: TailscaleServeTarget,
) {
  const target = tailscaleServeTargetUrl(input);
  return yield* assessTailscaleServe({ ...input, target }).pipe(
    Effect.map((assessed): TailscaleServeInspection => {
      const decision = decideTailscaleServeClaim({
        config: assessed.config,
        servePort: input.servePort,
        target,
        recordedTarget: assessed.claims.get(input.servePort) ?? null,
      });
      const state: TailscaleServeState =
        decision._tag === "Ours" && decision.current
          ? "configured"
          : decision._tag === "Ours" || decision._tag === "Free"
            ? "not-configured"
            : decision._tag === "HeldByOther"
              ? "port-held"
              : decision._tag === "TcpForward"
                ? "tcp-forward"
                : "other-mounts";
      return {
        state,
        magicDnsName: assessed.magicDnsName,
        holder: describeDecision(decision),
        heldPorts: tailscaleServePortsHeldByOthers({
          config: assessed.config,
          target,
          claims: assessed.claims,
        }),
      };
    }),
    Effect.catchTags({
      TailscaleServeNotLoggedInError: () => Effect.succeed(inspectionFailure("not-logged-in")),
      TailscaleServeHttpsDisabledError: () => Effect.succeed(inspectionFailure("https-disabled")),
      TailscaleCliUnavailableError: () => Effect.succeed(inspectionFailure("cli-unavailable")),
      TailscaleCommandExitError: (error) =>
        Effect.succeed(
          inspectionFailure(
            error.stderrDiagnostic === "not-logged-in" ? "not-logged-in" : "failed",
          ),
        ),
    }),
    Effect.orElseSucceed(() => inspectionFailure("failed")),
  );
});
