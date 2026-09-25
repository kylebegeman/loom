import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

import { ForkRuntime, withForkRuntime } from "./ForkRuntime.ts";

describe("withForkRuntime", () => {
  it.effect("keeps the caller's scope, so request resources close with the request", () =>
    Effect.gen(function* () {
      // ForkLayer publishes its whole build context, which holds the server-lifetime scope.
      const serverScope = yield* Scope.make();
      const requestScope = yield* Scope.make();
      const seen = yield* withForkRuntime(Effect.scope).pipe(
        Effect.provideService(ForkRuntime, Context.make(Scope.Scope, serverScope)),
        Scope.provide(requestScope),
      );
      expect(seen).toBe(requestScope);
    }),
  );
});
