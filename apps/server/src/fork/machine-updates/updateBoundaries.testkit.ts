import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import type { UpdatePlan } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import { ProjectionStoreV2 } from "../../orchestration-v2/ProjectionStore.ts";
import { layer as fenceLayer } from "./UpdateFence.ts";
import { layer as handoffLayer } from "./UpdateHandoff.ts";
import { UpdatePlanStore } from "./UpdatePlanStore.ts";
import { layer as plansLayer } from "./UpdatePlans.ts";
import { UpdateRuntime } from "./UpdateRuntime.ts";

export const stoppedThread = (id: string): OrchestrationV2ThreadShell => ({
  ...liveThreadShell(ThreadId.make(id), { activeRunId: null }),
  status: "completed",
});

export const updateBoundaryFixture = (initial: UpdatePlan | null = null) =>
  Effect.gen(function* () {
    const saved = yield* Ref.make(initial);
    const threads = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
    const archivedThreads = yield* Ref.make<ReadonlyArray<OrchestrationV2ThreadShell>>([]);
    const writes = yield* Ref.make(0);
    const store = Layer.succeed(UpdatePlanStore, {
      read: Ref.get(saved),
      write: (plan) => Ref.set(saved, plan).pipe(Effect.andThen(Ref.update(writes, (n) => n + 1))),
    });
    const handoff = handoffLayer.pipe(
      Layer.provideMerge(fenceLayer),
      Layer.provide(store),
      Layer.provide(
        Layer.mock(ProjectionStoreV2)({
          getShellSnapshot: () =>
            Effect.all({
              threads: Ref.get(threads),
              archivedThreads: Ref.get(archivedThreads),
            }).pipe(
              Effect.map((rows) => ({
                schemaVersion: 1,
                snapshotSequence: 0,
                ...rows,
              })),
            ),
        }),
      ),
    );
    const plans = plansLayer.pipe(
      Layer.provideMerge(handoff),
      Layer.provide(store),
      Layer.provide(
        Layer.succeed(UpdateRuntime, {
          currentVersion: "0.1.0",
          supported: true,
          install: () => Effect.die("A boundary test must never install an update"),
        }),
      ),
    );
    return { saved, threads, archivedThreads, writes, handoff, plans };
  });
