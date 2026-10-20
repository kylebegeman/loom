import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import {
  VaultError,
  type VaultAccessContext,
  type VaultAccessExplanation,
  type VaultDecisionInput,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultCore from "./VaultCore.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
export class VaultAccessInspector extends Context.Service<
  VaultAccessInspector,
  {
    readonly explain: (
      input: VaultDecisionInput,
      restrictMetadata?: boolean,
    ) => Effect.Effect<VaultAccessExplanation, VaultError>;
  }
>()("t3/fork/vault/VaultAccessInspector") {}
const sameRun = (a: OrchestrationV2ThreadShell, b: OrchestrationV2ThreadShell | null) =>
  b !== null &&
  b.archivedAt === null &&
  b.deletedAt === null &&
  a.projectId === b.projectId &&
  a.activeRunId === b.activeRunId &&
  a.providerInstanceId === b.providerInstanceId &&
  a.runtimeMode === b.runtimeMode &&
  a.interactionMode === b.interactionMode;
const make = Effect.gen(function* () {
  const access = yield* VaultAccess.VaultAccess,
    core = yield* VaultCore.VaultCore,
    profiles = yield* VaultProfiles.VaultProfiles,
    workloads = yield* VaultWorkloads.VaultWorkloads,
    brokers = yield* VaultBrokers.VaultBrokers,
    threads = yield* ThreadManagementService;
  return VaultAccessInspector.of({
    explain: Effect.fn("VaultAccessInspector.explain")(function* (input, restrictMetadata) {
      const explanation = yield* access.explain(input, restrictMetadata);
      // Inspect-granted metadata is also the ceiling for related context, including counts.
      if (!explanation.item) return explanation;
      const checkedAt = yield* Clock.currentTimeMillis;
      const empty: VaultAccessContext = {
        checkedAt,
        freshUntil: checkedAt + 60_000,
        state: "unavailable",
        providerInstanceId: null,
        runId: null,
        profiles: [],
        sessions: [],
        approvals: [],
        omittedProfiles: 0,
        omittedSessions: 0,
        omittedApprovals: 0,
        externalConsumers: "not-discovered",
        providerCopies: "unknown",
      };
      const initial = yield* threads.getThreadShell(input.threadId).pipe(Effect.result);
      if (initial._tag === "Failure") return { ...explanation, context: empty };
      if (
        !initial.success ||
        initial.success.projectId !== explanation.projectId ||
        initial.success.archivedAt !== null ||
        initial.success.deletedAt !== null
      )
        return { ...explanation, context: { ...empty, state: "changed" as const } };
      const thread = initial.success;
      const observed = yield* Effect.all(
        {
          profiles: profiles.list(thread.projectId).pipe(Effect.result),
          sessions: workloads.list(input.threadId).pipe(Effect.result),
          brokers: brokers.snapshot.pipe(Effect.result),
          approvals: access.approvalInbox.pipe(Effect.result),
        },
        { concurrency: 4 },
      );
      const matchedProfiles =
        observed.profiles._tag === "Success"
          ? observed.profiles.success.profiles.flatMap((p) => {
              const requirements = p.bindings
                .filter((b) => b.itemId === input.itemId)
                .map((b) => b.name);
              return requirements.length
                ? [
                    {
                      id: p.id,
                      label: p.label,
                      version: p.version,
                      state: p.state,
                      selected:
                        observed.profiles._tag === "Success" &&
                        observed.profiles.success.activeProfileId === p.id,
                      requirements,
                    },
                  ]
                : [];
            })
          : [];
      const sessions =
        observed.sessions._tag === "Success"
          ? observed.sessions.success.filter(
              (s) =>
                s.threadId === input.threadId &&
                s.runId === thread.activeRunId &&
                s.providerInstanceId === thread.providerInstanceId &&
                s.projectId === thread.projectId &&
                s.environmentId === explanation.environmentId &&
                s.itemId === input.itemId &&
                s.expiresAt > checkedAt,
            )
          : [];
      const machines =
        observed.brokers._tag === "Success" &&
        observed.brokers.success.environmentId === explanation.environmentId
          ? observed.brokers.success.machines
          : [];
      const requests =
        observed.approvals._tag === "Success"
          ? observed.approvals.success.requests
              .filter(
                (r) =>
                  r.threadId === input.threadId &&
                  r.projectId === thread.projectId &&
                  r.itemId === input.itemId,
              )
              .toSorted(
                (a, b) =>
                  Number(b.state === "pending") - Number(a.state === "pending") ||
                  b.requestedAt - a.requestedAt,
              )
          : [];
      const context: VaultAccessContext = {
        ...empty,
        state: Object.values(observed).every((r) => r._tag === "Success") ? "current" : "partial",
        freshUntil: Math.min(
          empty.freshUntil,
          ...sessions.map((s) => s.expiresAt),
          ...requests
            .map((r) => r.approvedUntil ?? r.requestExpiresAt)
            .filter((at) => at > checkedAt),
          ...machines
            .filter(
              (m) =>
                m.state === "active" &&
                m.leaseUntil > checkedAt &&
                sessions.some((s) => s.machineId === m.id),
            )
            .map((m) => m.leaseUntil),
        ),
        providerInstanceId: thread.providerInstanceId,
        runId: thread.activeRunId,
        profiles: matchedProfiles.slice(0, 16),
        omittedProfiles: Math.max(0, matchedProfiles.length - 16),
        omittedSessions: Math.max(0, sessions.length - 8),
        sessions: sessions.slice(0, 8).map((s) => {
          const machine = machines.find((m) => m.id === s.machineId);
          return {
            id: s.id,
            machineId: s.machineId,
            machineLabel: machine?.label ?? null,
            destination: s.destination,
            expiresAt: s.expiresAt,
            brokerState: !machine
              ? "unknown"
              : machine.state === "disabled"
                ? "disabled"
                : machine.leaseUntil <= checkedAt
                  ? "offline"
                  : "online",
          };
        }),
        approvals: requests
          .slice(0, 16)
          .map((r) => ({ id: r.id, state: r.state, until: r.approvedUntil ?? r.requestExpiresAt })),
        omittedApprovals: Math.max(0, requests.length - 16),
      };
      const latest = yield* Effect.all({
        thread: threads.getThreadShell(input.threadId).pipe(Effect.result),
        policy: access.snapshot.pipe(Effect.result),
        item: core.inspect(input.itemId).pipe(Effect.result),
        profiles: profiles.list(thread.projectId).pipe(Effect.result),
      });
      if (
        latest.thread._tag === "Failure" ||
        latest.policy._tag === "Failure" ||
        latest.item._tag === "Failure" ||
        latest.profiles._tag === "Failure"
      )
        return { ...explanation, context: { ...empty, state: "unavailable" as const } };
      const now = yield* Clock.currentTimeMillis;
      if (
        !sameRun(thread, latest.thread.success) ||
        latest.policy.success.revision !== explanation.decision.policyRevision ||
        latest.item.success?.version !== explanation.item.version ||
        now >= context.freshUntil ||
        (observed.profiles._tag === "Success" &&
          latest.profiles._tag === "Success" &&
          observed.profiles.success.revision !== latest.profiles.success.revision) ||
        (explanation.decision.expiresAt !== null && now >= explanation.decision.expiresAt)
      )
        return { ...explanation, context: { ...empty, state: "changed" as const } };
      // Related references are observations, never an inventory of external credential copies.
      return { ...explanation, context };
    }),
  });
});
export const layer = Layer.effect(VaultAccessInspector, make);
