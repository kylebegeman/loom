import { expect, it } from "@effect/vitest";
import { VaultError, VaultGitHubError, VaultSshError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as VaultHealth from "./VaultHealth.ts";
import { observeVaultHealth } from "./health-observation.ts";
it.effect(
  "records delivery failures without replacing their outcome, and never resolves health on nonzero exit",
  () =>
    Effect.gen(function* () {
      const reports: Array<Parameters<VaultHealth.VaultHealth["Service"]["report"]>[0]> = [];
      const layer = Layer.mock(VaultHealth.VaultHealth)({
        report: (input) =>
          Effect.sync(() => {
            reports.push(input);
          }),
      });
      yield* observeVaultHealth(Effect.succeed({ exitCode: 7 }), "a".repeat(32), 1).pipe(
        Effect.provide(layer),
      );
      expect(reports).toEqual([]);
      yield* observeVaultHealth(Effect.succeed({ exitCode: 255 }), "a".repeat(32), 1).pipe(
        Effect.provide(layer),
      );
      expect(reports.map((r) => [r.category, r.healthy])).toEqual([["configuration", false]]);
      reports.length = 0;
      yield* observeVaultHealth(
        Effect.fail(new VaultSshError({ reason: "failed" })),
        "a".repeat(32),
        1,
      ).pipe(Effect.provide(layer), Effect.flip);
      expect(reports.map((r) => [r.category, r.healthy])).toEqual([["configuration", false]]);
      reports.length = 0;
      const error = new VaultGitHubError({ reason: "unavailable" });
      expect(
        yield* observeVaultHealth(Effect.fail(error), "a".repeat(32), 1, { kind: "github" }).pipe(
          Effect.provide(layer),
          Effect.flip,
        ),
      ).toBe(error);
      expect(reports.map((r) => [r.category, r.healthy])).toEqual([["outage", false]]);
      expect(reports[0]?.outageTarget).toEqual({ kind: "github" });
      reports.length = 0;
      yield* observeVaultHealth(
        Effect.fail(new VaultError({ reason: "denied" })),
        "a".repeat(32),
        1,
      ).pipe(Effect.provide(layer), Effect.flip);
      expect(reports).toEqual([]);
      yield* observeVaultHealth(Effect.succeed({ exitCode: 0 }), "a".repeat(32), 1).pipe(
        Effect.provide(layer),
      );
      expect(reports.map((r) => [r.category, r.healthy])).toEqual([
        ["authentication", true],
        ["outage", true],
        ["configuration", true],
      ]);
    }),
);
it.effect(
  "a maintenance-store outage cannot turn an already completed remote write into a retryable failure",
  () =>
    observeVaultHealth(Effect.succeed({ exitCode: 0 }), "a".repeat(32), 1).pipe(
      Effect.provide(
        Layer.mock(VaultHealth.VaultHealth)({
          report: () => Effect.fail(new VaultError({ reason: "unavailable" })),
        }),
      ),
      Effect.tap((result) => Effect.sync(() => expect(result).toEqual({ exitCode: 0 }))),
    ),
);
