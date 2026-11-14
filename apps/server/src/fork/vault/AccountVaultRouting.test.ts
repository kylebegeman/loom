import { expect, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import { AccountVaultRouting, layer } from "./AccountVaultRouting.ts";
import { OpenBaoStore } from "./OpenBaoStore.ts";
import { AccountWorkloads } from "../account-access/AccountWorkloads.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";

it.effect(
  "routes an enrolled workload to the advertised backend instead of an unconfigured Library",
  () =>
    Effect.gen(function* () {
      const received: string[] = [];
      let released = false;
      let outage = false;
      const routing = yield* AccountVaultRouting.pipe(
        Effect.provide(
          layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(OpenBaoStore)({
                  status: Effect.succeed({
                    backend: "openbao",
                    state: "unconfigured",
                    origin: null,
                  }),
                }),
                Layer.mock(DirectoryService)({
                  list: Effect.succeed({
                    environments: [
                      {
                        environmentId: EnvironmentId.make("vault-host"),
                        label: "Vault computer",
                        vaultBackend: true,
                        routes: [{ kind: "public", url: "https://vault.test/" }],
                      },
                    ],
                  } as never),
                }),
                Layer.mock(AccountWorkloads)({
                  acceptProvider: () =>
                    Effect.succeed({ sourceEnvironmentId: EnvironmentId.make("source") } as never),
                  accept: () =>
                    Effect.succeed({ sourceEnvironmentId: EnvironmentId.make("source") } as never),
                  relay: (_lease, host) => {
                    received.push(host);
                    return Effect.succeed("relay:" + "a".repeat(64));
                  },
                  releaseRelay: () =>
                    Effect.sync(() => {
                      released = true;
                    }),
                }),
                Layer.succeed(
                  HttpClient.HttpClient,
                  HttpClient.make((request) => {
                    received.push(request.url);
                    return Effect.succeed(
                      HttpClientResponse.fromWeb(
                        request,
                        outage
                          ? Response.json(new VaultError({ reason: "unavailable" }), {
                              status: 503,
                            })
                          : Response.json({ kind: "resolve", report: { state: "ready" } }),
                      ),
                    );
                  }),
                ),
              ),
            ),
          ),
        ),
      );
      const result = yield* routing.forward(
        { payload: "{}", proof: "source-proof" },
        { sessionId: AuthSessionId.make("publisher") } as never,
        "workload",
      );
      expect(Option.getOrThrow(result)).toEqual({ kind: "resolve", report: { state: "ready" } });
      expect(received).toEqual(["vault-host", "https://vault.test/api/loom/account/vault/relay"]);
      expect(released).toBe(true);
      outage = true;
      const unavailable = yield* routing.forward(
        { payload: "{}", proof: "source-proof" },
        { sessionId: AuthSessionId.make("publisher") } as never,
        "status",
      );
      expect(Option.getOrThrow(unavailable)).toMatchObject({
        state: "unavailable",
        host: { environmentId: "vault-host", label: "Vault computer" },
      });
    }),
);
