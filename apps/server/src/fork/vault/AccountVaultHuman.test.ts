import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, AuthVaultReadScope, EnvironmentId } from "@t3tools/contracts";
import { ACCOUNT_ACCESS_HEADER, VaultCoreRpcGroup, VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcServer from "effect/rpc/RpcServer";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { SessionStore } from "../../auth/SessionStore.ts";
import { AccountAccess } from "../account-access/AccountAccess.ts";
import { VaultAccess } from "./VaultAccess.ts";
import { AccountVaultRouting } from "./AccountVaultRouting.ts";
import * as Human from "./AccountVaultHuman.ts";

it.live(
  "carries the owner's Vault request over an account-authenticated socket and preserves locked/denied results",
  () =>
    Effect.gen(function* () {
      const status = {
        backend: "openbao" as const,
        state: "locked" as const,
        origin: "https://bao.test",
        host: { environmentId: EnvironmentId.make("vault-host"), label: "Vault computer" },
      };
      const app = yield* RpcServer.toHttpEffectWebsocket(VaultCoreRpcGroup).pipe(
        Effect.provide(
          Layer.mergeAll(
            RpcSerialization.layerJson,
            VaultCoreRpcGroup.toLayer({
              "loom.vault-core.status": () => Effect.succeed(status),
              "loom.vault-core.list": () => Effect.fail(new VaultError({ reason: "denied" })),
              "loom.vault-core.reveal": () => Effect.die("Unexpected reveal"),
              "loom.vault-core.save": () => Effect.die("Unexpected save"),
              "loom.vault-core.change": () => Effect.die("Unexpected change"),
            }),
          ),
        ),
      );
      let authenticated = 0;
      yield* Layer.build(
        HttpServer.serve(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            expect(request.headers[ACCOUNT_ACCESS_HEADER]).toBe("single-use-grant");
            authenticated++;
            return yield* app;
          }),
        ),
      );
      const server = yield* HttpServer.HttpServer;
      const origin = HttpServer.formatAddress(server.address);
      const human = yield* Human.AccountVaultHuman.pipe(
        Effect.provide(
          Human.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(AccountVaultRouting)({
                  backend: Effect.succeedSome({
                    environmentId: EnvironmentId.make("vault-host"),
                  } as never),
                }),
                Layer.mock(AccountAccess)({
                  prepare: () =>
                    Effect.succeed({
                      origin: origin,
                      grant: "single-use-grant",
                      lease: { keyFingerprint: "pin", membershipRevision: 1 },
                    }),
                  awaitRemoval: () => Effect.never,
                }),
                Layer.mock(VaultAccess)({}),
                Layer.mock(SessionStore)({
                  cookieName: "test",
                  legacyCookieName: undefined,
                  awaitInvalidation: () => Effect.never,
                }),
              ),
            ),
          ),
        ),
      );
      const session = {
        sessionId: AuthSessionId.make("owner-device"),
        subject: "identity-principal:v1:owner",
        method: "bearer-access-token" as const,
        scopes: [AuthVaultReadScope],
      };
      expect(
        Option.getOrThrow(yield* human.forward(session, "loom.vault-core.status", {})),
      ).toEqual(status);
      expect(
        yield* human
          .forward(session, "loom.vault-core.list", { cursor: null, includeArchived: false })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "denied" });
      expect(authenticated).toBe(2);
      expect(yield* human.forward(session, "loom.other.status", {})).toEqual(Option.none());
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(NodeHttpServer.layerTest, NodeServices.layer)),
    ),
);
