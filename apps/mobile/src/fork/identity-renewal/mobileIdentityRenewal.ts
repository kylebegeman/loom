import { mobileAccess } from "../cloudflare-access/mobileAccess"; // fork: cloudflare-access
// @effect-diagnostics globalDate:off -- The shared grant helpers are Promise APIs that take a wall clock.
import { IdentityRenewal } from "@t3tools/client-runtime/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as SecureStore from "expo-secure-store";

import { makeIdentityGrantStore } from "./grantStore";
import { makeIdentityRenewal } from "./renewal";

/**
 * Readable after the first unlock, so renewal works when the app resumes behind a locked screen.
 * Kept on this device only: a backup restored to a second phone would replay the same rotating
 * refresh token, and Pocket ID answers that reuse by revoking the grant on both.
 */
const keychain: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** One store and one renewal per process, so locking and single-flight cover every caller. */
export const identityGrantStore = makeIdentityGrantStore({
  getItem: (key) => SecureStore.getItemAsync(key, keychain),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, keychain),
  removeItem: (key) => SecureStore.deleteItemAsync(key, keychain),
});

const mobileIdentityRenewal = makeIdentityRenewal({
  store: identityGrantStore,
  fetch: mobileAccess.fetch,
  now: () => Date.now(),
});

export const addIdentityRenewal = Context.add(IdentityRenewal, {
  ...mobileIdentityRenewal,
  forget: (request) =>
    mobileIdentityRenewal
      .forget(request)
      .pipe(Effect.andThen(Effect.promise(() => mobileAccess.forget(request.httpBaseUrl)))),
});
