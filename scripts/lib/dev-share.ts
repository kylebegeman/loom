/** Vite proxies the backend, so only the web port needs a share mapping. */

import {
  claimTailscaleServe, // fork: tailnet-ownership
  readTailscaleStatus,
  releaseTailscaleServe, // fork: tailnet-ownership
  type TailscaleCommandError,
  // fork: tailnet-ownership
  type TailscaleServeClaimError,
  type TailscaleServeTarget,
  type TailscaleStatusParseError,
  type TailscaleStderrDiagnostic,
} from "@t3tools/tailscale";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
// fork: tailnet-ownership -- unshareDevServer's type is inferred, so no spawner import

/** Log fixed diagnostics; tailscale stderr can contain auth keys and node names. */
const DIAGNOSTIC_EXPLANATIONS: Record<TailscaleStderrDiagnostic, string | undefined> = {
  "no-existing-handler": "no mapping existed for that port",
  "not-logged-in": "this machine is not logged into a tailnet — run `tailscale up`",
  "permission-denied": "permission denied — `tailscale serve` may need elevated privileges",
  unknown: undefined,
};

// fork: tailnet-ownership
const explainCommandFailure = (
  error: TailscaleCommandError | TailscaleStatusParseError,
): string | undefined =>
  error._tag === "TailscaleCommandExitError" && error.stderrDiagnostic !== undefined
    ? (DIAGNOSTIC_EXPLANATIONS[error.stderrDiagnostic] ?? "run the command by hand to see why")
    : undefined;

export class TailscaleUnavailableError extends Schema.TaggedError<TailscaleUnavailableError>()(
  "TailscaleUnavailableError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "could not talk to tailscale";
  }

  get hint(): string {
    return "Is Tailscale installed and tailscaled running? Try `tailscale status` — or drop --share and open the printed localhost URL.";
  }
}

export class TailnetNameMissingError extends Schema.TaggedError<TailnetNameMissingError>()(
  "TailnetNameMissingError",
  {},
) {
  override get message(): string {
    return "this machine has no tailnet DNS name";
  }

  get hint(): string {
    return "Run `tailscale up` and make sure MagicDNS is enabled.";
  }
}

export class DevServeFailedError extends Schema.TaggedError<DevServeFailedError>()(
  "DevServeFailedError",
  {
    stage: Schema.Literals(["claim", "serve"]), // fork: tailnet-ownership
    webPort: Schema.Number,
    explanation: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const port = String(this.webPort);
    // fork: tailnet-ownership
    const base =
      this.stage === "claim"
        ? `did not share port ${port} on the tailnet`
        : `could not serve port ${port} on the tailnet`;
    return this.explanation ? `${base}: ${this.explanation}` : base;
  }

  get hint(): undefined {
    return undefined;
  }
}

export type DevShareError =
  | TailscaleUnavailableError
  | TailnetNameMissingError
  | DevServeFailedError;

// fork: tailnet-ownership
export interface DevShareTarget {
  readonly webPort: number;
  /** Records the mapping this checkout owns, so the next run recognizes one a crash left behind. */
  readonly claimsPath: string;
  readonly localTarget?: { readonly port: number; readonly host: string };
}

// fork: tailnet-ownership
const serveTarget = (input: DevShareTarget): TailscaleServeTarget => ({
  claimsPath: input.claimsPath,
  servePort: input.webPort,
  localPort: input.localTarget?.port ?? input.webPort,
  // Vite's localhost can bind only ::1; a 127.0.0.1 proxy target would return 502.
  localHost: input.localTarget?.host ?? "localhost",
});

// fork: tailnet-ownership
const toServeFailure = (webPort: number, error: TailscaleServeClaimError): DevServeFailedError => {
  switch (error._tag) {
    case "TailscaleServeNotLoggedInError":
    case "TailscaleServeHttpsDisabledError":
    case "TailscaleServePortHeldError":
    case "TailscaleServePortTcpForwardError":
    case "TailscaleServeOtherMountsError":
    case "TailscaleServeClaimRecordError":
      return new DevServeFailedError({
        stage: "claim",
        webPort,
        explanation: error.message,
        cause: error,
      });
    default: {
      const explanation = explainCommandFailure(error);
      return new DevServeFailedError({
        stage: "serve",
        webPort,
        ...(explanation !== undefined ? { explanation } : {}),
        cause: error,
      });
    }
  }
};

// fork: tailnet-ownership
export interface DevUnshareResult {
  readonly cleared: boolean;
  readonly explanation?: string | undefined;
  readonly cause?: unknown;
}

// fork: tailnet-ownership
/**
 * Removes the `/` mapping only while it still proxies to this dev server.
 * Finalizer cleanup must be uninterruptible or cancellation can leave stale mappings.
 */
export const unshareDevServer = (input: DevShareTarget) =>
  releaseTailscaleServe(serveTarget(input)).pipe(
    Effect.map((): DevUnshareResult => ({ cleared: true })),
    Effect.catch((error) => {
      const explanation =
        error._tag === "TailscaleServeClaimRecordError"
          ? error.message
          : explainCommandFailure(error);
      return Effect.succeed<DevUnshareResult>({
        cleared: false,
        ...(explanation !== undefined ? { explanation } : {}),
        cause: error,
      });
    }),
    Effect.uninterruptible,
  );

export interface DevShareResult {
  readonly url: string;
  readonly host: string;
}

// fork: tailnet-ownership
/**
 * Publishes `webPort` on the tailnet. The tailnet port always matches the web
 * port so the URL is stable; `localTarget` points it at the backend instead
 * when the backend serves a built client (`--built`). Another app's mapping on
 * the port is never replaced.
 */
export const shareDevServer = Effect.fn("devShare.shareDevServer")(function* (
  input: DevShareTarget, // fork: tailnet-ownership
) {
  const status = yield* readTailscaleStatus.pipe(
    Effect.mapError((error) => new TailscaleUnavailableError({ cause: error })),
  );
  if (status.magicDnsName === null) {
    return yield* new TailnetNameMissingError();
  }

  // fork: tailnet-ownership
  const claim = yield* claimTailscaleServe(serveTarget(input)).pipe(
    Effect.mapError((error) => toServeFailure(input.webPort, error)),
  );

  // fork: tailnet-ownership
  return { url: claim.baseUrl, host: status.magicDnsName } satisfies DevShareResult;
});
