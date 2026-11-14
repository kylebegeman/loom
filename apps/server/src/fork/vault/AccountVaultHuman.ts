import {
  ACCOUNT_ACCESS_HEADER,
  AccountVaultFailure,
  VaultAccessRpcGroup,
  VaultBrokerRpcGroup,
  VaultCoreRpcGroup,
  VaultError,
  VaultGitHubRpcGroup,
  VaultHealthRpcGroup,
  VaultMigrationInventoryRpcGroup,
  VaultMigrationRpcGroup,
  VaultProfileRpcGroup,
  VaultReferenceRpcGroup,
  VaultSshRpcGroup,
  VaultTestAccountRpcGroup,
} from "@t3tools/contracts/fork";
import { AuthAccessReadScope, AuthAccessWriteScope } from "@t3tools/contracts";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import { upstreamWebSocketConstructor } from "../../device/DeviceHubProxy.ts";
import { SessionStore } from "../../auth/SessionStore.ts";
import * as AccountAccess from "../account-access/AccountAccess.ts";
import * as Routing from "./AccountVaultRouting.ts";
import * as VaultAccess from "./VaultAccess.ts";

const group = VaultCoreRpcGroup.merge(
  VaultAccessRpcGroup,
  VaultBrokerRpcGroup,
  VaultGitHubRpcGroup,
  VaultHealthRpcGroup,
  VaultMigrationInventoryRpcGroup,
  VaultMigrationRpcGroup,
  VaultProfileRpcGroup,
  VaultReferenceRpcGroup,
  VaultSshRpcGroup,
  VaultTestAccountRpcGroup,
);
const makeClient = RpcClient.make(group, { flatten: true });
const decodeFailure = Schema.decodeUnknownOption(AccountVaultFailure);
export class AccountVaultHuman extends Context.Service<
  AccountVaultHuman,
  {
    readonly forward: (
      session: AuthenticatedSession,
      method: string,
      input: unknown,
    ) => Effect.Effect<Option.Option<unknown>, typeof AccountVaultFailure.Type>;
  }
>()("t3/fork/vault/AccountVaultHuman") {}
const make = Effect.gen(function* () {
  const routing = yield* Routing.AccountVaultRouting;
  const access = yield* AccountAccess.AccountAccess;
  const vault = yield* VaultAccess.VaultAccess;
  const sessions = yield* SessionStore;
  return AccountVaultHuman.of({
    forward: Effect.fn("AccountVaultHuman.forward")(function* (session, method, input) {
      if (!group.requests.has(method) || method.startsWith("loom.vault-owner-link."))
        return Option.none();
      const backend = yield* routing.backend;
      if (Option.isNone(backend)) {
        if (
          !session.scopes.includes(AuthAccessReadScope) &&
          !session.scopes.includes(AuthAccessWriteScope) &&
          method !== "loom.vault-core.status"
        )
          yield* vault.authorizeHuman(session.subject);
        return Option.none();
      }
      const prepared = yield* access
        .prepare({
          caller: session,
          environmentId: backend.value.environmentId,
          method: "GET",
          path: "/ws",
        })
        .pipe(Effect.mapError(() => new VaultError({ reason: "denied" })));
      const protocol = Layer.effect(
        RpcClient.Protocol,
        RpcClient.makeProtocolSocket({
          retryTransientErrors: false,
          retryPolicy: Schedule.recurs(0),
        }),
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            Socket.layerWebSocket(`${prepared.origin.replace(/^http/u, "ws")}/ws`, {
              headers: { [ACCOUNT_ACCESS_HEADER]: prepared.grant },
              openTimeout: "10 seconds",
            }).pipe(Layer.provide(upstreamWebSocketConstructor)),
            RpcSerialization.layerJson,
          ),
        ),
      );
      const request = Effect.gen(function* () {
        const client = yield* makeClient;
        // The source handler and destination RPC schemas check this transport's dynamic dispatch.
        return Option.some(yield* client(method as Parameters<typeof client>[0], input as never));
      }).pipe(Effect.provide(protocol), Effect.scoped);
      const revoked = Effect.raceFirst(
        sessions.awaitInvalidation(session.sessionId),
        access.awaitRemoval(backend.value.environmentId, prepared.lease),
      ).pipe(Effect.andThen(Effect.fail(new VaultError({ reason: "denied" }))));
      return yield* Effect.raceFirst(request, revoked).pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError((error) =>
          Option.getOrElse(decodeFailure(error), () => new VaultError({ reason: "unavailable" })),
        ),
      );
    }),
  });
});
export const layer = Layer.effect(AccountVaultHuman, make);
