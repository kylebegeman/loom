// @vitest-environment jsdom
import { expect, it } from "@effect/vitest";
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  EnvironmentRegistry,
} from "@t3tools/client-runtime/connection";
import { storedDirectoryListing } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import type { LoomDesktopSignInResult } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
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

const LIBRARY = EnvironmentId.make("library");

/** A registry holding only the chosen Library, whose directory read is `run`. */
const libraryRegistry = (run: () => Effect.Effect<unknown, never>) =>
  Effect.gen(function* () {
    const connectionId = "bearer:library";
    const entries = yield* SubscriptionRef.make(
      new Map([
        [
          LIBRARY,
          {
            target: new BearerConnectionTarget({
              environmentId: LIBRARY,
              label: "Helios",
              connectionId,
            }),
            profile: Option.some(
              new BearerConnectionProfile({
                connectionId,
                environmentId: LIBRARY,
                label: "Helios",
                httpBaseUrl: "https://library.example.com/",
                wsBaseUrl: "wss://library.example.com/ws",
              }),
            ),
            enabled: true,
          },
        ],
      ]),
    );
    return { entries, run } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];
  });

it.effect("sends desktop main the Library's directory for a typed address", () =>
  Effect.gen(function* () {
    const signInToLoom = vi.fn(async () => signedIn);
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: { signInToLoom, forgetLoomIdentity: vi.fn(async () => {}) },
    });
    const answer = storedDirectoryListing(
      LIBRARY,
      {
        environments: [
          {
            environmentId: STUDIO,
            label: "Studio",
            serverVersion: "1.0.0",
            platform: { os: "darwin", arch: "arm64" },
            supportsExecution: true,
            loomFeatures: [],
            routes: [{ kind: "tailnet", url: URL }],
            providers: [],
            sequence: 1,
            reportedAt: "2026-10-20T12:00:00.000Z",
            keyFingerprint: "a".repeat(64),
            firstSeenAt: "2026-10-20T11:00:00.000Z",
            receivedAt: "2026-10-20T12:00:00.000Z",
          },
        ],
        machines: [],
        generatedAt: "2026-10-20T12:00:00.000Z",
      },
      Date.parse("2026-10-20T12:00:00.000Z"),
    );
    const registry = yield* libraryRegistry(() => Effect.succeed(answer));

    // Only the request matters here, so the finished sign-in stops before saving. An AbortSignal
    // cannot be cloned over IPC, so it must stay behind with the rest of the renderer-only input.
    yield* execute({
      httpBaseUrl: URL,
      typedAddressLibrary: LIBRARY,
      verify: () => REFUSED,
      signal: new AbortController().signal,
    }).pipe(Effect.flip, Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, registry));

    expect(signInToLoom).toHaveBeenCalledWith({
      httpBaseUrl: URL,
      directory: {
        library: {
          environmentId: LIBRARY,
          label: "Helios",
          addresses: ["https://library.example.com/"],
        },
        computers: [{ environmentId: STUDIO, label: "Studio", addresses: [URL] }],
      },
    });
  }),
);

it.effect("never opens the browser for a sign-in cancelled while it reads the directory", () =>
  Effect.gen(function* () {
    const signInToLoom = vi.fn(async () => signedIn);
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: { signInToLoom, forgetLoomIdentity: vi.fn(async () => {}) },
    });
    // A Library that never answers keeps the sign-in reading until it is cancelled.
    const registry = yield* libraryRegistry(() => Effect.never);
    const abort = new AbortController();
    const fiber = yield* execute({
      httpBaseUrl: URL,
      typedAddressLibrary: LIBRARY,
      signal: abort.signal,
    }).pipe(
      Effect.flip,
      Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, registry),
      Effect.forkChild,
    );
    abort.abort();

    expect((yield* Fiber.join(fiber)).message).toBe("Loom sign-in cancelled.");
    expect(signInToLoom).not.toHaveBeenCalled();
  }),
);
