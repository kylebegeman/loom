import type { EnvironmentId } from "@t3tools/contracts";
import {
  LOOM_IDENTITY_METADATA_PATH,
  LoomIdentityMetadata,
  type DirectoryRoute,
  type LoomDesktopSignInRequest,
  type LoomIdentityAccount,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import { connectionRoutes } from "../connection/routes.ts";
import {
  DIRECTORY_PAIRING_REASON_TEXT,
  directoryConnectPlan,
  type DirectoryCatalogRow,
  type DirectoryPairingReason,
  type DirectorySignIn,
  type DirectorySignInSurface,
} from "./directory.ts";

/** A tailnet route the device cannot reach can hang until the OS gives up; the next one waits. */
const IDENTITY_READ_TIMEOUT = "8 seconds";

const decodeMetadata = Schema.decodeUnknownEffect(LoomIdentityMetadata);

/** What one address said. Null metadata: a server answered there without Loom sign-in. */
export type DirectoryIdentityRead =
  | { readonly reached: true; readonly metadata: LoomIdentityMetadata | null }
  | { readonly reached: false };

const UNREACHED: DirectoryIdentityRead = { reached: false };

/**
 * Reads the public sign-in settings at one address. Any failure, including an answer that is not
 * metadata, means the address did not answer usefully, so the caller tries the next one.
 */
export const readDirectoryIdentity = Effect.fn("DirectoryComputers.readIdentity")(function* (
  httpBaseUrl: string,
) {
  const http = yield* HttpClient.HttpClient;
  return yield* http.get(new URL(LOOM_IDENTITY_METADATA_PATH, httpBaseUrl).href).pipe(
    Effect.flatMap((response) =>
      response.status === 404
        ? Effect.succeed(null)
        : HttpClientResponse.filterStatusOk(response).pipe(
            Effect.flatMap((ok) => ok.json),
            Effect.flatMap(decodeMetadata),
          ),
    ),
    Effect.map((metadata): DirectoryIdentityRead => ({ reached: true, metadata })),
    // The metadata is public and served to any origin, so a plain GET without trace headers
    // reaches it from a browser without a CORS preflight.
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error", credentials: "omit" }),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.timeout(IDENTITY_READ_TIMEOUT),
    Effect.orElseSucceed(() => UNREACHED),
  );
});

/** What this device knows about its Library's Identity, from its saved Library connection. */
export interface DirectoryLibraryTrust {
  readonly environmentId: EnvironmentId;
  /** The account this device signed in to the Library with, when it used Loom Identity. */
  readonly account: LoomIdentityAccount | null;
  /** The Library's saved addresses, to read its issuer from when no account is recorded. */
  readonly httpBaseUrls: readonly string[];
}

export function directoryLibraryTrust(entry: ConnectionCatalogEntry): DirectoryLibraryTrust {
  let account: LoomIdentityAccount | null = null;
  const httpBaseUrls = new Set<string>();
  for (const route of connectionRoutes(entry)) {
    if (route.target._tag === "PrimaryConnectionTarget") httpBaseUrls.add(route.target.httpBaseUrl);
    const profile = Option.getOrNull(route.profile);
    if (profile?._tag !== "BearerConnectionProfile") continue;
    httpBaseUrls.add(profile.httpBaseUrl);
    account ??= profile.identity ?? null;
  }
  return { environmentId: entry.target.environmentId, account, httpBaseUrls: [...httpBaseUrls] };
}

/**
 * The Library's Identity issuer: the one this device signed in to it with, otherwise the one its
 * own metadata names. Null when neither is known, which keeps every computer on pairing.
 */
export const directoryLibraryIssuer = Effect.fn("DirectoryComputers.libraryIssuer")(function* (
  library: DirectoryLibraryTrust,
) {
  if (library.account !== null) return library.account.issuer;
  for (const httpBaseUrl of library.httpBaseUrls) {
    const read = yield* readDirectoryIdentity(httpBaseUrl);
    if (!read.reached) continue;
    const metadata = read.metadata;
    return metadata !== null && metadata.enabled && metadata.environmentId === library.environmentId
      ? metadata.issuer
      : null;
  }
  return null;
});

export type DirectoryConnectStep =
  | {
      readonly kind: "sign-in";
      readonly surface: DirectorySignInSurface;
      readonly environmentId: EnvironmentId;
      readonly route: DirectoryRoute;
      /**
       * For desktop's `signInToLoom`, the browser popup sign-in or the phone's native sign-in.
       * It pins the Library's issuer, and its account when known, so a computer that switched
       * provider since the plan is refused before the provider opens.
       */
      readonly request: LoomDesktopSignInRequest;
      /** The Library's issuer. Check the finished sign-in with `directorySignInMismatch`. */
      readonly issuer: string;
    }
  | {
      readonly kind: "pairing";
      /** Pair expecting this computer, so an address that reaches another one is refused. */
      readonly environmentId: EnvironmentId;
      /**
       * Prefill the pairing form's address with this. Null when every listed address answered as
       * another computer: a pairing code sent there would reach that computer instead.
       */
      readonly httpBaseUrl: string | null;
      readonly reason: DirectoryPairingReason;
      readonly reasonText: string;
    };

const pairing = (
  environmentId: EnvironmentId,
  route: DirectoryRoute | undefined,
  reason: DirectoryPairingReason,
): DirectoryConnectStep => ({
  kind: "pairing",
  environmentId,
  httpBaseUrl: route?.url ?? null,
  reason,
  reasonText: DIRECTORY_PAIRING_REASON_TEXT[reason],
});

/**
 * How to connect a discovered computer: read its sign-in settings from its routes in order,
 * skipping a route that does not answer or reaches another computer, then offer Loom Identity at
 * the first route that answered when the computer uses the Library's issuer. Null for a saved
 * connection or a computer with no usable route.
 */
export const resolveDirectoryConnect = Effect.fn("DirectoryComputers.resolveConnect")(
  function* (input: {
    readonly row: DirectoryCatalogRow;
    readonly signIn: DirectorySignIn;
    readonly library: DirectoryLibraryTrust;
  }) {
    const { row, signIn, library } = input;
    const routes = directoryConnectPlan(row, null, { signIn, libraryIssuer: null })?.routes ?? [];
    if (routes.length === 0) return null;

    let answered: {
      readonly route: DirectoryRoute;
      readonly read: LoomIdentityMetadata | null;
    } | null = null;
    const unreached: DirectoryRoute[] = [];
    for (const route of routes) {
      const read = yield* readDirectoryIdentity(route.url);
      if (!read.reached) {
        unreached.push(route);
        continue;
      }
      if (read.metadata !== null && read.metadata.environmentId !== row.environmentId) continue;
      answered = { route, read: read.metadata };
      break;
    }
    // Only an address that did not answer as another computer may be prefilled.
    if (answered === null)
      return pairing(
        row.environmentId,
        unreached[0],
        unreached.length > 0 ? "unreachable" : "other-computer",
      );

    const libraryIssuer = yield* directoryLibraryIssuer(library);
    const plan = directoryConnectPlan(row, answered.read, { signIn, libraryIssuer });
    if (plan === null || plan.reason !== null || libraryIssuer === null)
      return pairing(row.environmentId, answered.route, plan?.reason ?? "no-sign-in");
    return {
      kind: "sign-in",
      surface: signIn.surface,
      environmentId: row.environmentId,
      route: answered.route,
      request: {
        httpBaseUrl: answered.route.url,
        expectedEnvironmentId: row.environmentId,
        expectedIssuer: libraryIssuer,
        ...(library.account === null ? {} : { expectedIdentity: library.account }),
      },
      issuer: libraryIssuer,
    } satisfies DirectoryConnectStep;
  },
);

export interface DirectoryPlanConnectInput {
  readonly row: DirectoryCatalogRow;
  readonly signIn: DirectorySignIn;
  /** The Library authority the listing came from. Its saved connection supplies the issuer. */
  readonly libraryEnvironmentId: EnvironmentId;
}

/** `resolveDirectoryConnect` with the Library's trust read from this device's saved connections. */
export const planDirectoryConnect = Effect.fn("DirectoryComputers.planConnect")(function* (
  input: DirectoryPlanConnectInput,
) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const entry = (yield* SubscriptionRef.get(registry.entries)).get(input.libraryEnvironmentId);
  const library: DirectoryLibraryTrust =
    entry === undefined
      ? { environmentId: input.libraryEnvironmentId, account: null, httpBaseUrls: [] }
      : directoryLibraryTrust(entry);
  return yield* resolveDirectoryConnect({ row: input.row, signIn: input.signIn, library });
});

/**
 * Null when a finished sign-in is the planned computer's session under the Library's issuer and
 * account. Otherwise one short line, and the caller must not save the connection: the computer
 * changed its settings between the plan and the sign-in.
 */
export function directorySignInMismatch(
  step: Extract<DirectoryConnectStep, { readonly kind: "sign-in" }>,
  result: {
    readonly environmentId: EnvironmentId;
    readonly identity?: LoomIdentityAccount | undefined;
  },
): string | null {
  if (result.environmentId !== step.environmentId)
    return DIRECTORY_PAIRING_REASON_TEXT["other-computer"];
  if (result.identity === undefined)
    return "Loom could not confirm which account signed in to this computer.";
  if (result.identity.issuer !== step.issuer)
    return DIRECTORY_PAIRING_REASON_TEXT["issuer-mismatch"];
  const expected = step.request.expectedIdentity;
  if (expected !== undefined && result.identity.subject !== expected.subject)
    return "Sign in with the same account you use for your Library.";
  return null;
}
