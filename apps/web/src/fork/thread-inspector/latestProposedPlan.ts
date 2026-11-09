import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2PlanArtifact, PlanId, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export interface LatestProposedPlanState {
  readonly id: PlanId;
  readonly updatedAt: string;
  readonly runId: RunId | null;
  readonly status: OrchestrationV2PlanArtifact["status"];
}

function planItemTime(
  projection: ThreadStructure,
  plan: Pick<OrchestrationV2PlanArtifact, "id" | "runId">,
): string {
  const item = projection.turnItems.findLast(
    (candidate) =>
      (candidate.type === "proposed_plan" || candidate.type === "todo_list") &&
      candidate.planId === plan.id,
  );
  if (item?.type === "proposed_plan" || item?.type === "todo_list") {
    return DateTime.formatIso(item.updatedAt);
  }
  // Without a plan item, the plan's run dates it; the thread's own timestamps move while a reply streams.
  const run = projection.runs.find((candidate) => candidate.id === plan.runId);
  return DateTime.formatIso(
    run?.completedAt ?? run?.startedAt ?? run?.requestedAt ?? projection.thread.createdAt,
  );
}

export function findLatestProposedPlan(
  projection: ThreadStructure | null,
  latestRunId: RunId | null,
): LatestProposedPlanState | null {
  if (projection === null) return null;
  const plans = projection.plans.filter((plan) => plan.kind === "proposed_plan");
  const candidates = latestRunId ? plans.filter((plan) => plan.runId === latestRunId) : plans;
  const plan = [...(candidates.length > 0 ? candidates : plans)]
    .toSorted(
      (left, right) =>
        planItemTime(projection, left).localeCompare(planItemTime(projection, right)) ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
  return plan === undefined
    ? null
    : {
        id: plan.id,
        updatedAt: planItemTime(projection, plan),
        runId: plan.runId,
        status: plan.status,
      };
}

export function hasActionableProposedPlan(plan: LatestProposedPlanState | null): boolean {
  return plan?.status === "active";
}
