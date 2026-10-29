import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as HttpObservability from "./httpObservability.ts";

it.effect(
  "keeps Access credentials and existing authentication secrets out of inspected HTTP headers",
  () =>
    Effect.gen(function* () {
      const headers = Headers.fromInput({
        authorization: "Bearer loom-private",
        cookie: "session=private-cookie",
        dpop: "private-proof",
        "expo-session": "private-expo",
        "cf-access-token": "private-access",
        "cf-access-client-secret": "private-machine",
        "cf-access-jwt-assertion": "private-assertion",
        accept: "application/json",
      });
      const inspected = Headers.redact(headers, yield* Headers.CurrentRedactedNames);
      expect(JSON.stringify(inspected)).not.toContain("private");
      expect(inspected.accept).toBe("application/json");
    }).pipe(Effect.provide(HttpObservability.layer)),
);
