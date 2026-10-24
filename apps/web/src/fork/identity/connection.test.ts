// @vitest-environment jsdom
import { expect, it } from "@effect/vitest";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import type { LoomDesktopSignInResult } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { afterEach, vi } from "vite-plus/test";

// The command's own program, without the app's connection runtime.
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createRuntimeCommand: (_runtime: unknown, options: unknown) => options,
}));
import { connectLoomIdentity, type LoomIdentityConnectInput } from "./connection";

const STUDIO = EnvironmentId.make("studio");
const URL = "https://studio.example.ts.net";
const IDENTITY = { issuer: "https://other.example.com", subject: "kyle" };
const signedIn: LoomDesktopSignInResult = {
  httpBaseUrl: URL,
  environmentId: STUDIO,
  accessToken: "token",
  identity: IDENTITY,
  expiresAt: 1,
};
const REFUSED = "This computer uses a different sign-in provider than your Library.";

const { execute } = connectLoomIdentity as unknown as {
  readonly execute: (input: LoomIdentityConnectInput) => Effect.Effect<EnvironmentId, Error>;
};

afterEach(() => {
  delete window.desktopBridge;
});

it.effect("saves nothing and forgets the new desktop grant when the check refuses it", () =>
  Effect.gen(function* () {
    const signInToLoom = vi.fn(async () => signedIn);
    const forgetLoomIdentity = vi.fn(async () => {});
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: { signInToLoom, forgetLoomIdentity },
    });
    const register = vi.fn();
    const verify = vi.fn(() => REFUSED);
    const entries = yield* SubscriptionRef.make(new Map());

    const error = yield* execute({ httpBaseUrl: URL, expectedEnvironmentId: STUDIO, verify }).pipe(
      Effect.flip,
      Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, {
        entries,
        register,
      } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
    );

    expect(error.message).toBe(REFUSED);
    expect(verify).toHaveBeenCalledWith(signedIn);
    expect(register).not.toHaveBeenCalled();
    expect(forgetLoomIdentity).toHaveBeenCalledWith({
      httpBaseUrl: URL,
      environmentId: STUDIO,
      identity: IDENTITY,
    });
    // A function cannot cross to desktop main, so only the request is sent.
    expect(signInToLoom).toHaveBeenCalledWith({ httpBaseUrl: URL, expectedEnvironmentId: STUDIO });
  }),
);
