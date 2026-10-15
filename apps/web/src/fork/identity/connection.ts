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
import type { LoomDesktopSignInRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { connectionAtomRuntime } from "~/connection/runtime";

class LoomIdentityConnectionError extends Schema.TaggedError<LoomIdentityConnectionError>()(
  "LoomIdentityConnectionError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

/** Native sign-in enrolls a normal bearer route, preserving all existing paired and relay connections. */
export const connectLoomIdentity = createRuntimeCommand(connectionAtomRuntime, {
  label: "loom:identity:connect",
  concurrency: {
    mode: "singleFlight",
    key: (input: LoomDesktopSignInRequest) => input.httpBaseUrl,
  },
  execute: Effect.fn("web.loomIdentity.connect")(function* (input: LoomDesktopSignInRequest) {
    const result = yield* Effect.tryPromise({
      try: () => {
        if (!window.desktopBridge?.signInToLoom)
          throw new Error("Update Loom Desktop to use account sign-in.");
        return window.desktopBridge.signInToLoom(input);
      },
      catch: (cause) =>
        new LoomIdentityConnectionError({
          detail: cause instanceof Error ? cause.message : "Could not sign in to Loom.",
        }),
    });
    const descriptor = yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl: result.httpBaseUrl });
    if (descriptor.environmentId !== result.environmentId)
      return yield* new LoomIdentityConnectionError({
        detail:
          "This address now reaches a different computer. Retry sign-in with the correct Library address.",
      });
    const compatibility = orchestrationProtocolCompatibilityError(descriptor);
    if (compatibility && compatibility.serverUpdateRequired !== true) return yield* compatibility;
    yield* fetchRemoteSessionState({
      httpBaseUrl: result.httpBaseUrl,
      bearerToken: result.accessToken,
    });
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const connectionId = `bearer:${result.environmentId}:${new URL(result.httpBaseUrl).origin}`;
    yield* registry.register(
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
        }),
        credential: new BearerConnectionCredential({ token: result.accessToken }),
      }),
    );
    return result.environmentId;
  }),
});
