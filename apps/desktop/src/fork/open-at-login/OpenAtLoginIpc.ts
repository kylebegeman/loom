import { DesktopOpenAtLoginState } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import * as IpcChannels from "../../ipc/channels.ts";
import * as OpenAtLogin from "./OpenAtLogin.ts";

const getOpenAtLoginState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_AT_LOGIN_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopOpenAtLoginState,
  handler: Effect.fn("desktop.ipc.openAtLogin.getState")(function* () {
    return yield* (yield* OpenAtLogin.OpenAtLogin).state;
  }),
});

const setOpenAtLoginEnabled = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_AT_LOGIN_SET_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: DesktopOpenAtLoginState,
  handler: Effect.fn("desktop.ipc.openAtLogin.setEnabled")(function* (enabled) {
    return yield* (yield* OpenAtLogin.OpenAtLogin).setEnabled(enabled);
  }),
});

const openLoginItemSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_AT_LOGIN_OPEN_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.openAtLogin.openSettings")(function* () {
    return yield* (yield* OpenAtLogin.OpenAtLogin).openSystemSettings;
  }),
});

export const installOpenAtLoginIpc = Effect.fn("desktop.ipc.openAtLogin.install")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(getOpenAtLoginState);
  yield* ipc.handle(setOpenAtLoginEnabled);
  yield* ipc.handle(openLoginItemSettings);
});
