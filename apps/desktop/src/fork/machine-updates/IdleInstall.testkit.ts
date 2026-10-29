import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { DesktopBackendStartConfig } from "../../backend/DesktopBackendManager.ts";
import {
  BackendInstanceId,
  type DesktopBackendInstance,
} from "../../backend/DesktopBackendPool.ts";

export const config = (port: number, secret: string): DesktopBackendStartConfig => ({
  executablePath: "/fixture/electron",
  entryPath: "/fixture/server",
  cwd: "/fixture",
  args: [],
  env: {},
  extendEnv: false,
  httpBaseUrl: new URL(`http://127.0.0.1:${port}`),
  bootstrapDelivery: "fd3",
  captureOutput: false,
  preflightFailure: Option.none(),
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port,
    t3Home: "/fixture",
    host: "127.0.0.1",
    desktopBootstrapSecret: secret,
    desktopBootstrapToken: "initial-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
});
export const instance = (
  id: string,
  current: DesktopBackendStartConfig | null,
  running = true,
): DesktopBackendInstance => ({
  id: BackendInstanceId(id),
  label: Effect.succeed(id),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(Option.fromNullishOr(current)),
  snapshot: Effect.succeed({
    desiredRunning: running,
    ready: current !== null,
    activePid: Option.none(),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(current !== null),
});
