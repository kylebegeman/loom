import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { OrchestrationEventStore } from "../../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../../serverActivation.ts";
import { CodeGraphService } from "./CodeGraphService.ts";

/**
 * Lets a turn that changed files in a project root queue an automatic graph update, removes a
 * deleted project's graph, and catches up on projects deleted while the server was down.
 */
export const startCodeGraphReactor = Effect.gen(function* () {
  const codeGraph = yield* CodeGraphService;
  const threads = yield* ThreadManagementService;
  const events = yield* OrchestrationEventStore;

  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      event.type === "checkpoint.captured" && event.payload.files.length > 0
        ? codeGraph.noteThreadChanged(event.payload.threadId).pipe(Effect.ignore({ log: true }))
        : Effect.void,
    ).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Code graph update stream failed", { cause })),
    ),
  );

  // Only deletions from now on; the catch-up below covers earlier ones.
  const afterSequence = yield* events.latestApplicationSequence.pipe(Effect.orElseSucceed(() => 0));
  yield* forkParked(
    Stream.runForEach(events.streamApplicationEvents({ afterSequence }), (event) =>
      "type" in event && event.type === "project.deleted"
        ? codeGraph.forgetProject(event.payload.projectId).pipe(Effect.ignore({ log: true }))
        : Effect.void,
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Code graph cleanup stream failed", { cause }),
      ),
    ),
  );

  yield* forkParked(
    codeGraph.forgetMissingProjects.pipe(
      Effect.catchCause((cause) => Effect.logWarning("Code graph catch-up skipped", { cause })),
    ),
  );
});

export const CodeGraphReactorLive = Layer.effectDiscard(startCodeGraphReactor);
