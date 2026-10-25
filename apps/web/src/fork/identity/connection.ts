import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  EnvironmentRegistry,
  orchestrationProtocolCompatibilityError,
} from "@t3tools/client-runtime/connection";
import {
  fetchRemoteEnvironmentDescriptor,
  deriveWsBaseUrl,
} from "@t3tools/client-runtime/environment";
import { fetchRemoteSessionState } from "@t3tools/client-runtime/authorization";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { LoomDesktopSignInRequest, LoomDesktopSignInResult } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { signInToLoomBrowser } from "~/rpc/loomIdentity";
import { connectionAtomRuntime } from "~/connection/runtime";

class LoomIdentityConnectionError extends Schema.TaggedError<LoomIdentityConnectionError>()(
  "LoomIdentityConnectionError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

const register = Effect.fn("web.loomIdentity.register")(function* (
  result: LoomDesktopSignInResult,
  registry: EnvironmentRegistry.EnvironmentRegistry["Service"],
) {
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl: result.httpBaseUrl });
  if (descriptor.environmentId !== result.environmentId)
    return yield* new LoomIdentityConnectionError({
      detail:
        "This address now reaches a different computer. Retry sign-in with the correct computer address.",
    });
  const compatibility = orchestrationProtocolCompatibilityError(descriptor);
  if (compatibility && compatibility.serverUpdateRequired !== true) return yield* compatibility;
  yield* fetchRemoteSessionState({
    httpBaseUrl: result.httpBaseUrl,
    bearerToken: result.accessToken,
  });
  const connectionId = `bearer:${result.environmentId}:${new URL(result.httpBaseUrl).origin}`;
  const registered = yield* registry.register(
    new BearerConnectionRegistration({
      target: new BearerConnectionTarget({
        environmentId: result.environmentId,
        label: descriptor.label,
        connectionId,
      }),
      profile: new BearerConnectionProfile({
        environmentId: result.environmentId,
        label: descriptor.label,
        connectionId,
        httpBaseUrl: result.httpBaseUrl,
        wsBaseUrl: deriveWsBaseUrl(result.httpBaseUrl),
        ...(result.identity ? { identity: result.identity } : {}),
        ...(result.resource === undefined ? {} : { identityResource: result.resource }),
      }),
      credential: new BearerConnectionCredential({
        token: result.accessToken,
        ...(result.identity && result.expiresAt
          ? {
              identity: {
                ...result.identity,
                environmentId: result.environmentId,
                expiresAt: result.expiresAt,
              },
            }
          : {}),
      }),
    }),
  );
  if (!registered)
    return yield* new LoomIdentityConnectionError({
      detail: "This computer is managed by this app. Open its own address to sign in.",
    });
  yield* registry.setEnabled(result.environmentId, true);
  return result.environmentId;
});

export type LoomIdentityConnectInput = LoomDesktopSignInRequest & {
  readonly popup?: Window;
  /**
   * Checks the finished sign-in before anything is saved. A returned line refuses it: nothing is
   * saved, and a grant desktop just kept is forgotten.
   */
  readonly verify?: (result: LoomDesktopSignInResult) => string | null;
};

/** Native sign-in enrolls a normal bearer route, preserving all existing paired and relay connections. */
export const connectLoomIdentity = createRuntimeCommand(connectionAtomRuntime, {
  label: "loom:identity:connect",
  concurrency: {
    mode: "singleFlight",
    key: (input: LoomIdentityConnectInput) => input.httpBaseUrl,
  },
  execute: Effect.fn("web.loomIdentity.connect")(function* (input: LoomIdentityConnectInput) {
    // Only the request crosses to desktop main: a window or function cannot be sent over IPC.
    const { popup, verify, ...request } = input;
    const result = yield* Effect.tryPromise({
      try: () => {
        if (popup) return signInToLoomBrowser(request, popup);
        if (!window.desktopBridge?.signInToLoom)
          throw new Error("Open sign-in again to connect this computer.");
        return window.desktopBridge.signInToLoom(request);
      },
      catch: (cause) =>
        new LoomIdentityConnectionError({
          detail: cause instanceof Error ? cause.message : "Could not sign in to Loom.",
        }),
    });
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    // Desktop main saved this computer's refresh grant during sign-in. Only removing a saved
    // connection forgets a grant, so a first connection that fails here ends it now. A computer
    // that is already saved keeps the grant, since its connection may still renew with it.
    const identity = result.identity;
    const unsaved =
      popup === undefined &&
      identity !== undefined &&
      !(yield* SubscriptionRef.get(registry.entries)).has(result.environmentId);
    const refused = verify?.(result) ?? null;
    return yield* (
      refused === null
        ? register(result, registry)
        : Effect.fail(new LoomIdentityConnectionError({ detail: refused }))
    ).pipe(
      Effect.onError(() =>
        unsaved && identity
          ? Effect.tryPromise(
              async () =>
                await window.desktopBridge?.forgetLoomIdentity?.({
                  httpBaseUrl: result.httpBaseUrl,
                  environmentId: result.environmentId,
                  identity,
                }),
            ).pipe(Effect.ignore)
          : Effect.void,
      ),
    );
  }),
});
