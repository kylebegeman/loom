import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { LoomDesktopSignInRequest, LoomDesktopSignInResult } from "@t3tools/contracts/fork";
import { signInToLoom as enroll, cancelLoomSignIn as cancel } from "../../app/LoomIdentity.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

class LoomIdentityError extends Schema.TaggedError<LoomIdentityError>()("LoomIdentityError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}
export const signInToLoom = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOOM_SIGN_IN_CHANNEL,
  payload: LoomDesktopSignInRequest,
  result: LoomDesktopSignInResult,
  handler: Effect.fn("desktop.ipc.loomIdentity.signIn")(function* (input) {
    const shell = yield* ElectronShell.ElectronShell;
    const windows = yield* ElectronWindow.ElectronWindow;
    const context = yield* Effect.context<ElectronShell.ElectronShell>();
    const runPromise = Effect.runPromiseWith(context);
    const result = yield* Effect.tryPromise({
      try: (signal) =>
        enroll(input.httpBaseUrl, (url) => runPromise(shell.openExternal(url)), signal),
      catch: (cause) =>
        new LoomIdentityError({
          detail: cause instanceof Error ? cause.message : "Could not sign in to Loom. Try again.",
        }),
    });
    const window = yield* windows.currentMainOrFirst;
    if (Option.isSome(window)) yield* windows.reveal(window.value);
    return result;
  }),
});
export const cancelLoomSignIn = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOOM_CANCEL_SIGN_IN_CHANNEL,
  payload: LoomDesktopSignInRequest,
  result: Schema.Void,
  handler: (input) =>
    Effect.try({
      try: () => cancel(input.httpBaseUrl),
      catch: () => new LoomIdentityError({ detail: "The Library address is invalid." }),
    }),
});
