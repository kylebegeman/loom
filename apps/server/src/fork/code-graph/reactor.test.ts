import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { OrchestrationEventStore } from "../../persistence/OrchestrationEventStore.ts";
import { CodeGraphService } from "./CodeGraphService.ts";
import { startCodeGraphReactor } from "./reactor.ts";

function partial<A extends object>(methods: Partial<A>): A {
  return new Proxy(methods as A, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const checkpoint = (threadId: string, files: number) => ({
  type: "checkpoint.captured",
  payload: { threadId: ThreadId.make(threadId), files: Array.from({ length: files }, () => ({})) },
});

describe("startCodeGraphReactor", () => {
  it.live("updates after turns that changed files and forgets deleted projects", () =>
    Effect.gen(function* () {
      const changed = yield* Deferred.make<string>();
      const forgotten = yield* Deferred.make<string>();
      const caughtUp = yield* Deferred.make<void>();
      let afterSequence: number | undefined;
      const codeGraph = partial<CodeGraphService["Service"]>({
        noteThreadChanged: (threadId) => Deferred.succeed(changed, threadId).pipe(Effect.asVoid),
        forgetProject: (projectId) => Deferred.succeed(forgotten, projectId).pipe(Effect.asVoid),
        forgetMissingProjects: Deferred.succeed(caughtUp, undefined).pipe(Effect.asVoid),
      });
      const threads = partial<ThreadManagementService["Service"]>({
        streamDomainEvents: Stream.make(
          checkpoint("unchanged", 0),
          checkpoint("changed", 2),
        ) as unknown as ThreadManagementService["Service"]["streamDomainEvents"],
      });
      const events = partial<OrchestrationEventStore["Service"]>({
        latestApplicationSequence: Effect.succeed(41),
        streamApplicationEvents: (input) => {
          afterSequence = input?.afterSequence;
          return Stream.make(
            { sequence: 42, commandId: null, event: { type: "thread.created" } },
            {
              type: "project.deleted",
              payload: { projectId: ProjectId.make("gone"), deletedAt: "" },
            },
          ) as never;
        },
      });

      yield* startCodeGraphReactor.pipe(
        Effect.provideService(CodeGraphService, codeGraph),
        Effect.provideService(ThreadManagementService, threads),
        Effect.provideService(OrchestrationEventStore, events),
      );

      expect(yield* Deferred.await(changed)).toBe("changed");
      expect(yield* Deferred.await(forgotten)).toBe("gone");
      yield* Deferred.await(caughtUp);
      expect(afterSequence).toBe(41);
    }).pipe(Effect.scoped),
  );
});
