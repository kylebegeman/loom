import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as DesktopShutdown from "../../app/DesktopShutdown.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as DesktopServerExposure from "../../backend/DesktopServerExposure.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { setTailscaleServeEnabled } from "./serverExposure.ts";

describe("setTailscaleServeEnabled IPC", () => {
  it.effect("rejects a port outside 1-65535 instead of saving a substitute", () => {
    const saved: Array<{ readonly enabled: boolean; readonly port?: number }> = [];
    const layer = Layer.mergeAll(
      Layer.succeed(
        DesktopServerExposure.DesktopServerExposure,
        DesktopServerExposure.DesktopServerExposure.of({
          setTailscaleServeEnabled: (input: {
            readonly enabled: boolean;
            readonly port?: number;
          }) =>
            Effect.sync(() => saved.push(input)).pipe(Effect.andThen(Effect.die("unreachable"))),
        } as unknown as DesktopServerExposure.DesktopServerExposure["Service"]),
      ),
      Layer.succeed(
        DesktopLifecycle.DesktopLifecycle,
        DesktopLifecycle.DesktopLifecycle.of({
          relaunch: () => Effect.die("unexpected relaunch"),
          register: Effect.void,
        }),
      ),
      DesktopShutdown.layer,
      DesktopState.layer,
      Layer.succeed(
        DesktopEnvironment.DesktopEnvironment,
        DesktopEnvironment.DesktopEnvironment.of(
          {} as DesktopEnvironment.DesktopEnvironment["Service"],
        ),
      ),
      Layer.succeed(
        DesktopWindow.DesktopWindow,
        DesktopWindow.DesktopWindow.of({} as DesktopWindow.DesktopWindow["Service"]),
      ),
      Layer.succeed(
        ElectronApp.ElectronApp,
        ElectronApp.ElectronApp.of({} as ElectronApp.ElectronApp["Service"]),
      ),
      Layer.succeed(
        ElectronTheme.ElectronTheme,
        ElectronTheme.ElectronTheme.of({} as ElectronTheme.ElectronTheme["Service"]),
      ),
    );
    return Effect.gen(function* () {
      for (const port of [0, 65_536, 443.5, -1]) {
        const result = yield* Effect.result(
          setTailscaleServeEnabled.handler({ enabled: true, port }),
        );
        assert.isTrue(Result.isFailure(result) && result.failure._tag === "SchemaError");
      }
      assert.deepEqual(saved, []);
    }).pipe(Effect.provide(layer));
  });
});
