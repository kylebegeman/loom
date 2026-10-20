import {
  type VaultHealthRecheckResult,
  VaultError,
  type VaultHealthClass,
  type VaultHealthOutageTarget,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { VaultHealthObservation } from "./health-observation.ts";
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultSsh from "./VaultSsh.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
export class VaultHealthChecks extends Context.Service<
  VaultHealthChecks,
  {
    readonly recheck: (itemId: string) => Effect.Effect<VaultHealthRecheckResult, VaultError>;
    readonly sweep: Effect.Effect<void, VaultError>;
  }
>()("t3/fork/vault/VaultHealthChecks") {}
const make = Effect.gen(function* () {
  const health = yield* VaultHealth.VaultHealth,
    github = yield* VaultGitHub.VaultGitHub,
    ssh = yield* VaultSsh.VaultSsh;
  const check = Effect.fn("VaultHealthChecks.check")(function* (itemId: string, force: boolean) {
    const claim = yield* health.claim(itemId, force);
    if (!claim) return false;
    const now = yield* Clock.currentTimeMillis;
    yield* health.report({
      itemId,
      itemVersion: claim.itemVersion,
      category: "expiry",
      healthy:
        claim.rule.expiresAt === null ||
        claim.rule.expiresAt > now + claim.rule.warningDays * 86400_000,
      observedAt: claim.observedAt,
      checkDeadline: claim.checkDeadline,
    });
    if (!claim.rule.githubRepository && !claim.rule.sshValidation) return true;
    const target = { id: itemId, expectedVersion: claim.itemVersion };
    let outageTarget: VaultHealthOutageTarget | undefined;
    const result = yield* Effect.gen(function* () {
      if (claim.rule.sshValidation) {
        const info = yield* ssh.info(itemId);
        if (info.item.version === claim.itemVersion)
          outageTarget = { kind: "ssh", hostname: info.target.hostname, port: info.target.port };
        yield* ssh.probe(target, Effect.void);
      } else {
        outageTarget = { kind: "github" };
        yield* github.test({ ...target, repository: claim.rule.githubRepository! }, Effect.void);
      }
    }).pipe(
      Effect.provideService(VaultHealthObservation, {
        observedAt: claim.observedAt,
        checkDeadline: claim.checkDeadline,
      }),
      Effect.result,
    );
    if (result._tag === "Success") {
      for (const category of ["authentication", "outage", "configuration"] as const)
        yield* health.report({
          itemId,
          itemVersion: claim.itemVersion,
          category,
          healthy: true,
          observedAt: claim.observedAt,
          checkDeadline: claim.checkDeadline,
        });
    } else {
      const error = result.failure;
      const category: VaultHealthClass =
        error._tag === "VaultGitHubError" &&
        ["unauthorized", "invalid-credential"].includes(error.reason)
          ? "authentication"
          : (error._tag === "VaultGitHubError" &&
                ["unavailable", "timeout"].includes(error.reason)) ||
              (error._tag === "VaultSshError" && error.reason === "timeout")
            ? "outage"
            : "configuration";
      yield* health.report({
        itemId,
        itemVersion: claim.itemVersion,
        category,
        healthy: false,
        ...(category === "outage" && outageTarget ? { outageTarget } : {}),
        observedAt: claim.observedAt,
        checkDeadline: claim.checkDeadline,
      });
    }
    return true;
  });
  return VaultHealthChecks.of({
    recheck: (itemId) =>
      Effect.gen(function* () {
        const checked = yield* check(itemId, true),
          snapshot = yield* health.snapshot;
        return {
          snapshot,
          outcome: checked
            ? "checked"
            : snapshot.rules.some((rule) => rule.itemId === itemId)
              ? "rate-limited"
              : "unconfigured",
        };
      }),
    sweep: Effect.gen(function* () {
      const snapshot = yield* health.snapshot,
        now = yield* Clock.currentTimeMillis;
      const due = snapshot.rules
        .filter((rule) => rule.automatic && rule.nextCheckAt <= now)
        .slice(0, 25);
      yield* Effect.forEach(due, (rule) => check(rule.itemId, false), {
        concurrency: 2,
        discard: true,
      });
    }),
  });
});
export const layer = Layer.effect(VaultHealthChecks, make);
export const reactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* VaultHealthChecks;
    yield* service.sweep.pipe(
      Effect.catch(() => Effect.void),
      Effect.repeat(Schedule.spaced("1 minute")),
      Effect.forkScoped,
    );
  }),
);
