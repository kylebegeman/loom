import { VaultGitHubError, VaultSshError, type VaultHealthClass } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as VaultHealth from "./VaultHealth.ts";
const isGitHub = Schema.is(VaultGitHubError),
  isSsh = Schema.is(VaultSshError);
export const observeVaultHealth = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  itemId: string,
  itemVersion: number,
) =>
  Effect.gen(function* () {
    const health = yield* Effect.serviceOption(VaultHealth.VaultHealth);
    if (Option.isNone(health)) return yield* effect;
    const report = (category: VaultHealthClass, healthy: boolean) =>
      health.value.report({ itemId, itemVersion, category, healthy }).pipe(Effect.ignore);
    return yield* effect.pipe(
      Effect.tap((result) =>
        typeof result === "object" &&
        result !== null &&
        "exitCode" in result &&
        result.exitCode !== 0
          ? report("configuration", false)
          : Effect.forEach(
              ["authentication", "outage"] as const,
              (category) => report(category, true),
              { discard: true },
            ),
      ),
      Effect.tapError((error) => {
        if (isGitHub(error)) {
          if (["unavailable", "timeout"].includes(error.reason)) return report("outage", false);
          if (["unauthorized", "invalid-credential"].includes(error.reason))
            return report("authentication", false);
        }
        if (isSsh(error)) {
          if (error.reason === "timeout") return report("outage", false);
          if (error.reason === "failed") return report("configuration", false);
        }
        return Effect.void;
      }),
    );
  });
