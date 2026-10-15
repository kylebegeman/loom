import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../../serverSettings.ts";
import * as SwitchboardStatus from "./SwitchboardStatus.ts";

const EVALUATED_AT = "2026-10-02T20:00:00.000Z";
const NOW = Date.parse(EVALUATED_AT);

const availability = (models: ReadonlyArray<Record<string, unknown>>) => ({
  version: 1,
  service: "switchboard",
  evaluatedAt: EVALUATED_AT,
  models,
});

const fixture = (
  options: {
    readonly enabled?: boolean;
    readonly environment?: NodeJS.ProcessEnv;
    readonly response?: Response;
    readonly transportFailure?: boolean;
  } = {},
) => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const http = HttpClient.make((request) => {
    requests.push({ url: request.url, headers: { ...request.headers } });
    return options.transportFailure
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause: "not reachable" }),
          }),
        )
      : Effect.succeed(
          HttpClientResponse.fromWeb(request, options.response ?? Response.json(availability([]))),
        );
  });
  const layer = SwitchboardStatus.layer.pipe(
    Layer.provideMerge(ServerSettings.layerTest({ switchboardEnabled: options.enabled ?? true })),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(Layer.succeed(HostProcess.Environment, options.environment ?? {})),
  );
  const readLimits = TestClock.setTime(NOW).pipe(
    Effect.andThen(SwitchboardStatus.SwitchboardStatus),
    Effect.flatMap((service) => service.readLimits),
  );
  return { layer, readLimits, requests };
};

describe("Switchboard availability", () => {
  it.effect("reads nothing, and parses no configuration, while routing is off", () => {
    const f = fixture({ enabled: false, environment: { LOOM_SWITCHBOARD_URL: "invalid" } });
    return Effect.gen(function* () {
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "disabled" });
      expect(f.requests).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("reads the local controller's v1 availability for the default hub", () => {
    const f = fixture({
      response: Response.json(
        availability([
          { id: "gpt-test", provider: "codex", state: "unavailable", reason: "limited" },
          { id: "claude-test", provider: "claude", state: "available", reason: "ready" },
        ]),
      ),
    });
    return Effect.gen(function* () {
      const result = yield* f.readLimits;
      expect(result.availability).toBe("available");
      expect(result.limits).toEqual([{ driver: "codex", servedModels: [], until: null }]);
      expect(f.requests.map((request) => request.url)).toEqual([
        "http://127.0.0.1:8318/api/v1/availability",
      ]);
      expect(f.requests[0]?.headers.authorization).toBeUndefined();
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("does not guess a controller for a remote hub", () => {
    const f = fixture({ environment: { LOOM_SWITCHBOARD_URL: "https://hub.example.test" } });
    return Effect.gen(function* () {
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "unconfigured" });
      expect(f.requests).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("reads the configured controller of a remote hub", () => {
    const f = fixture({
      environment: {
        LOOM_SWITCHBOARD_URL: "https://hub.example.test",
        LOOM_SWITCHBOARD_CONTROLLER_URL: "https://controller.example.test:8443",
      },
    });
    return Effect.gen(function* () {
      // A reachable controller with no reading yet still cannot report availability.
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "stale" });
      expect(f.requests.map((request) => request.url)).toEqual([
        "https://controller.example.test:8443/api/v1/availability",
      ]);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("observes routing being turned off without another request", () => {
    const f = fixture({
      response: Response.json(
        availability([{ id: "gpt-test", provider: "codex", state: "available", reason: "ready" }]),
      ),
    });
    return Effect.gen(function* () {
      expect((yield* f.readLimits).availability).toBe("available");
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* settings.updateSettings({ switchboardEnabled: false });
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "disabled" });
      expect(f.requests).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("fails open on an invalid controller setting", () => {
    const f = fixture({ environment: { LOOM_SWITCHBOARD_CONTROLLER_URL: "not a url" } });
    return Effect.gen(function* () {
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "unconfigured" });
      expect(f.requests).toEqual([]);
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("fails open when the controller is unreachable", () => {
    const f = fixture({ transportFailure: true });
    return Effect.gen(function* () {
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "unavailable" });
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("fails open on an HTTP error response", () => {
    const f = fixture({ response: Response.json({}, { status: 503 }) });
    return Effect.gen(function* () {
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "unavailable" });
    }).pipe(Effect.provide(f.layer));
  });

  it.effect("fails open on a payload from another API version", () => {
    const f = fixture({ response: Response.json({ ...availability([]), version: 2 }) });
    return Effect.gen(function* () {
      expect(yield* f.readLimits).toEqual({ limits: [], availability: "unavailable" });
    }).pipe(Effect.provide(f.layer));
  });
});
