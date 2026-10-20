import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import {
  VaultError,
  VaultReadinessInput,
  type VaultReadinessReport,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import * as VaultProfiles from "./VaultProfiles.ts";

export class VaultReadiness extends Context.Service<
  VaultReadiness,
  {
    readonly check: (input: VaultReadinessInput) => Effect.Effect<VaultReadinessReport, VaultError>;
  }
>()("t3/fork/vault/VaultReadiness") {}
const decode = Schema.decodeUnknownEffect(VaultReadinessInput, { onExcessProperty: "error" });
const sameContext = (a: OrchestrationV2ThreadShell, b: OrchestrationV2ThreadShell | null) =>
  b !== null &&
  a.projectId === b.projectId &&
  a.providerInstanceId === b.providerInstanceId &&
  a.activeRunId === b.activeRunId &&
  a.status === b.status &&
  a.runtimeMode === b.runtimeMode &&
  a.interactionMode === b.interactionMode &&
  b.archivedAt === null &&
  b.deletedAt === null;
const make = Effect.gen(function* () {
  const access = yield* VaultAccess.VaultAccess,
    workloads = yield* VaultWorkloads.VaultWorkloads,
    profiles = yield* VaultProfiles.VaultProfiles,
    threads = yield* ThreadManagementService;
  return VaultReadiness.of({
    check: Effect.fn("VaultReadiness.check")(function* (raw) {
      const input = yield* decode(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const initial = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      if (!initial || initial.archivedAt !== null || initial.deletedAt !== null)
        return yield* new VaultError({ reason: "denied" });
      // Avoid masking sealed/unconfigured status with an unrelated registry read failure.
      const baseline = yield* access.readiness(input);
      if (baseline.backend.state !== "ready") return baseline;
      const checks: VaultReadinessReport["checks"][number][] = [];
      let requirements: VaultReadinessInput["requirements"] = input.requirements;
      let observedProfile: { id: string; version: number; revision: number } | null = null;
      if (requirements.length === 0) {
        const registry = yield* profiles.listForThread(input.threadId);
        const selected = registry.profiles.find(
          (p) => p.id === registry.activeProfileId && p.state === "active",
        );
        if (!selected)
          checks.push({
            id: "profile-default",
            state: "blocked",
            reason: "No active project Vault profile is selected.",
            repair: "Choose a project profile or supply explicit requirements.",
          });
        else {
          observedProfile = {
            id: selected.id,
            version: selected.version,
            revision: registry.revision,
          };
          // Configuration inspection only. The evaluator below checks actual use; no live probe or durable run selection.
          const preview = yield* profiles
            .preview({ projectId: initial.projectId, profile: selected, threadId: null })
            .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
          requirements = preview.bindings.flatMap((b) =>
            b.itemId && b.destination
              ? [{ itemId: b.itemId, action: "use" as const, destination: b.destination }]
              : [],
          );
          for (const binding of preview.bindings)
            checks.push({
              id: `profile-binding:${binding.name}`,
              state:
                binding.state === "unchecked" || binding.state === "ready" ? "passed" : "blocked",
              reason:
                binding.state === "unchecked" || binding.state === "ready"
                  ? `Profile requirement ${binding.name} is configured; live access is checked separately.`
                  : `Profile requirement ${binding.name} is ${binding.state}.`,
              repair:
                "Repair the project's local binding and selected provider or host trust configuration.",
            });
          checks.push({
            id: "profile-default",
            state: "passed",
            reason: "Requirements were discovered from the active project profile.",
            repair: "Refresh after changing the profile. No retained run selection was written.",
          });
        }
      }
      const report =
        requirements === input.requirements
          ? baseline
          : yield* access.readiness({ ...input, requirements });
      const needsUse =
        requirements.some(
          (r) => r.action === "use" || r.action === "reveal" || r.action === "export",
        ) || input.requirements.length === 0;
      if (needsUse) {
        const live =
          initial.providerInstanceId !== null &&
          initial.activeRunId !== null &&
          initial.status === "running" &&
          initial.runtimeMode === "full-access" &&
          initial.interactionMode === "default";
        checks.push({
          id: "provider-runtime",
          state: live ? "passed" : "blocked",
          reason: live
            ? "The current provider owns a running full-access/default thread."
            : "Credential use needs a running full-access/default thread.",
          repair:
            "Start the intended provider run with the required permission mode, then check again.",
        });
      }
      const needsBroker = requirements.some(
        (r) =>
          r.action === "use" &&
          (r.destination?.startsWith("ssh://") || r.destination?.startsWith("git+ssh://")),
      );
      if (needsBroker) {
        if (!initial.providerInstanceId)
          checks.push({
            id: "enrolled-broker",
            state: "blocked",
            reason: "No current provider identity is available.",
            repair: "Start the intended provider run and refresh.",
          });
        else {
          const terminal = yield* workloads
            .terminalReadiness(input.threadId, initial.providerInstanceId)
            .pipe(Effect.result);
          checks.push({
            id: "enrolled-broker",
            state:
              terminal._tag === "Success" && terminal.success.brokerOnline ? "passed" : "blocked",
            reason:
              terminal._tag === "Success" && terminal.success.brokerOnline
                ? "An approved enrolled broker has current presence; this does not verify the selected execution host or upstream login."
                : "No current enrolled broker presence could be verified.",
            repair:
              "Check the intended broker's enrollment, startup, unlock and connection. Presence never substitutes for a selected-host operation check.",
          });
        }
      }
      const latest = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
      if (!sameContext(initial, latest))
        checks.push({
          id: "context-changed",
          state: "blocked",
          reason: "The project, provider or run changed during this check.",
          repair: "Run readiness again in the current context.",
        });
      if (observedProfile) {
        const current = yield* profiles.listForThread(input.threadId);
        if (
          current.revision !== observedProfile.revision ||
          current.activeProfileId !== observedProfile.id ||
          !current.profiles.some(
            (p) =>
              p.id === observedProfile.id &&
              p.version === observedProfile.version &&
              p.state === "active",
          )
        )
          checks.push({
            id: "profile-changed",
            state: "blocked",
            reason: "The active profile changed during this check.",
            repair: "Refresh the intended profile and check again.",
          });
      }
      const allChecks = [...report.checks, ...checks],
        now = yield* Clock.currentTimeMillis;
      if (now >= report.freshUntil)
        allChecks.push({
          id: "result-expired",
          state: "blocked",
          reason: "This readiness observation expired while it was running.",
          repair: "Check the connection and request a fresh result.",
        });
      return {
        ...report,
        checks: allChecks,
        ready: allChecks.every((c) => c.state === "passed") && now < report.freshUntil,
      };
    }),
  });
});
export const layer = Layer.effect(VaultReadiness, make);
