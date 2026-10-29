// @effect-diagnostics globalDate:off -- The native transport uses the device clock to renew OAuth credentials before a request.
import { makeCloudflareAccess } from "@t3tools/shared/fork/cloudflare-access";
import { NativeTransportAuth } from "@t3tools/client-runtime/fork";
import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import * as SecureStore from "expo-secure-store";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

const KEY = "loom.cloudflare-access.v1";
// Read on use: upstream tests load this module through runtime.ts with partial SecureStore mocks.
const keychain = (): SecureStore.SecureStoreOptions => ({
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
});
export const mobileAccess = makeCloudflareAccess({
  now: () => Date.now(),
  fetch: (url, init) => fetch(url, init),
  storage: {
    read: () => SecureStore.getItemAsync(KEY, keychain()),
    write: (value) => SecureStore.setItemAsync(KEY, value, keychain()),
  },
});

const auth = Layer.succeed(
  NativeTransportAuth,
  NativeTransportAuth.of({
    headers: Effect.fn("mobileAccess.headers")((url) =>
      Effect.tryPromise({
        try: async () => {
          const token = await mobileAccess.token(url);
          return token ? { "Cf-Access-Token": token } : undefined;
        },
        catch: () =>
          new ConnectionTransientError({
            reason: "network",
            detail:
              "Could not renew Cloudflare Access. Sign in to this computer again, or retry when connected.",
          }),
      }),
    ),
  }),
);
// React Native accepts handshake headers; the shared DOM declaration exposes only two arguments.
const NativeWebSocket: new (
  url: string,
  protocols?: string | string[],
  options?: { headers: Record<string, string> },
) => WebSocket = globalThis.WebSocket;
const socket = Layer.succeed(Socket.WebSocketConstructor, (url, options) => {
  if (options === undefined || typeof options === "string" || Array.isArray(options))
    return new WebSocket(url, options);
  return new NativeWebSocket(url, options.protocols, { headers: { ...options.headers } });
});
export const layer = Layer.merge(auth, socket);
