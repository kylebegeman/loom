import * as DesktopCloudflareAccess from "../../fork/cloudflare-access/DesktopCloudflareAccess.ts"; // fork: cloudflare-access
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import {
  LoomDesktopForgetRequest,
  LoomDesktopRenewRequest,
  LoomDesktopRenewResult,
  LoomDesktopSignInRequest,
  LoomDesktopSignInResult,
} from "@t3tools/contracts/fork";
import { signInToLoom as enroll, cancelLoomSignIn as cancel } from "../../app/LoomIdentity.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIdentityRenewal from "../../fork/identity-renewal/DesktopIdentityRenewal.ts";
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
    const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
    const access = yield* DesktopCloudflareAccess.DesktopCloudflareAccess;
    const context = yield* Effect.context<ElectronShell.ElectronShell>();
    const runPromise = Effect.runPromiseWith(context);
    const accessCreated = yield* access.signIn(input.httpBaseUrl, (url) =>
      runPromise(shell.openExternal(url)),
    );
    const signedIn = yield* Effect.tryPromise({
      try: (signal) =>
        enroll(
          input.httpBaseUrl,
          (url) => runPromise(shell.openExternal(url)),
          signal,
          input,
          access.fetch,
        ),
      catch: (cause) =>
        new LoomIdentityError({
          detail: cause instanceof Error ? cause.message : "Could not sign in to Loom. Try again.",
        }),
    }).pipe(
      Effect.onError(() =>
        accessCreated ? access.forget(input.httpBaseUrl).pipe(Effect.ignore) : Effect.void,
      ),
    );
    // The grant stays in this process; the renderer only receives the computer session.
    if (signedIn.grant) yield* renewal.save(signedIn.grant);
    const window = yield* windows.currentMainOrFirst;
    if (Option.isSome(window)) yield* windows.reveal(window.value);
    return signedIn.session;
  }),
});
export const cancelLoomSignIn = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOOM_CANCEL_SIGN_IN_CHANNEL,
  payload: LoomDesktopSignInRequest,
  result: Schema.Void,
  handler: (input) =>
    Effect.flatMap(DesktopCloudflareAccess.DesktopCloudflareAccess, (access) =>
      access.cancel(input.httpBaseUrl),
    ).pipe(
      Effect.andThen(
        Effect.try({
          try: () => cancel(input.httpBaseUrl),
          catch: () => new LoomIdentityError({ detail: "The computer address is invalid." }),
        }),
      ),
    ),
});
/** Rejects only for transient failures; a sign-in that cannot renew resolves `SignInRequired`. */
export const renewLoomIdentity = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOOM_IDENTITY_RENEW_CHANNEL,
  payload: LoomDesktopRenewRequest,
  result: LoomDesktopRenewResult,
  handler: Effect.fn("desktop.ipc.loomIdentity.renew")(function* (input) {
    const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
    return yield* renewal.renew(input);
  }),
});
export const forgetLoomIdentity = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOOM_IDENTITY_FORGET_CHANNEL,
  payload: LoomDesktopForgetRequest,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.loomIdentity.forget")(function* (input) {
    const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
    yield* renewal.forget(input);
    yield* (yield* DesktopCloudflareAccess.DesktopCloudflareAccess).forget(input.httpBaseUrl);
  }),
});
