// fork: desktop-primary-recovery
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
// fork: desktop-primary-recovery
import { EnvironmentId, type DesktopBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option"; // fork: desktop-primary-recovery
import { HttpClient } from "effect/http";

import { __resetDesktopPrimaryAuthForTests } from "./desktopAuth";
import * as PrimaryEnvironmentHttpLayer from "./httpLayer";

function createSignal<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("primary environment HTTP layer", { concurrent: false }, () => {
  afterEach(() => {
    __resetDesktopPrimaryAuthForTests();
    Reflect.deleteProperty(globalThis, "window");
    vi.unstubAllGlobals();
  });

  it.effect("uses cookie credentials for browser primary environments", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          href: "http://127.0.0.1:3773/settings",
          origin: "http://127.0.0.1:3773",
        },
      },
    });

    return Effect.gen(function* () {
      yield* HttpClient.get("http://127.0.0.1:3773/api/auth/session");

      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).toBe("include");
      expect(request.headers.get("authorization")).toBeNull();
    }).pipe(Effect.provide(PrimaryEnvironmentHttpLayer.layerForCurrentOrigin()));
  });

  it.effect("uses bearer auth without cookies for desktop-managed primaries", () => {
    const requested = createSignal<void>();
    const bearerToken = createSignal<string>();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { origin: "t3code://app" },
        desktopBridge: {
          getLocalEnvironmentBootstrap: () => ({
            label: "Local environment",
            httpBaseUrl: "http://127.0.0.1:3773",
            wsBaseUrl: "ws://127.0.0.1:3773",
            bootstrapToken: "desktop-bootstrap-token",
          }),
          getLocalEnvironmentBearerToken: () => {
            requested.resolve(undefined);
            return bearerToken.promise;
          },
        } as unknown as DesktopBridge,
      },
    });

    return Effect.gen(function* () {
      const requestFiber = yield* HttpClient.get(
        "http://127.0.0.1:3773/api/connect/link-state",
      ).pipe(Effect.forkChild);
      yield* Effect.promise(() => requested.promise);
      expect(fetchMock).not.toHaveBeenCalled();
      bearerToken.resolve("desktop-bearer-token");
      yield* Fiber.join(requestFiber);

      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).not.toBe("include");
      expect(request.headers.get("authorization")).toBe("Bearer desktop-bearer-token");
    }).pipe(Effect.provide(PrimaryEnvironmentHttpLayer.layerForCurrentOrigin()));
  });

  // fork: desktop-primary-recovery
  it.effect("retries primary discovery after the desktop credential bootstrap fails", () => {
    const descriptor = {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(descriptor), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const readBearer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Local credential bootstrap timed out"))
      .mockResolvedValue("desktop-bearer-token");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: { origin: "t3code://app" },
      desktopBridge: { getLocalEnvironmentBearerToken: readBearer },
    });

    return Effect.gen(function* () {
      const discover = fetchRemoteEnvironmentDescriptor({ httpBaseUrl: "http://127.0.0.1:3773" });
      const first = yield* discover.pipe(Effect.option);
      expect(Option.isNone(first)).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();

      const recovered = yield* discover;
      expect(recovered).toEqual(descriptor);
      expect(readBearer).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledOnce();
      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.headers.get("authorization")).toBe("Bearer desktop-bearer-token");
    }).pipe(Effect.provide(PrimaryEnvironmentHttpLayer.layerForCurrentOrigin()));
  });
});
