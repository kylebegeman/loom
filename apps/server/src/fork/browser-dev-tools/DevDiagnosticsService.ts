import {
  DevEnvironmentError,
  type DevDiagnosticsTarget,
  type DevBrowserDiagnostics,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
type Reader = (input: DevDiagnosticsTarget) => DevBrowserDiagnostics | undefined;
export class DevDiagnosticsService extends Context.Service<
  DevDiagnosticsService,
  {
    readonly read: (
      input: DevDiagnosticsTarget,
    ) => Effect.Effect<DevBrowserDiagnostics, DevEnvironmentError>;
    readonly register: (reader: Reader) => Effect.Effect<() => void>;
  }
>()("t3/fork/browser-dev-tools/DevDiagnosticsService") {}
export const layer = Layer.effect(
  DevDiagnosticsService,
  Effect.gen(function* () {
    const dev = yield* DevEnvironmentService;
    let reader: Reader | null = null;
    return DevDiagnosticsService.of({
      register: Effect.fn("DevDiagnosticsService.register")((next) =>
        Effect.sync(() => {
          reader = next;
          return () => {
            if (reader === next) reader = null;
          };
        }),
      ),
      read: Effect.fn("DevEnvironment.diagnostics")(function* (input) {
        yield* dev.snapshot(input);
        const result = reader?.(input);
        if (!result) return yield* new DevEnvironmentError({ reason: "browser-tab-unavailable" });
        return result;
      }),
    });
  }),
);
export const registerBrowserDiagnostics = Effect.fn("DevEnvironment.registerBrowserDiagnostics")(
  function* (reader: Reader) {
    const service = yield* Effect.serviceOption(DevDiagnosticsService);
    if (Option.isSome(service))
      yield* Effect.acquireRelease(service.value.register(reader), (release) =>
        Effect.sync(release),
      );
  },
);
