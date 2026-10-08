import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Semaphore from "effect/Semaphore";

/** Consumers lease a service-owned job. Only the last departure cancels its work. */
export const makeSharedJobs = <A, E>() =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const lock = yield* Semaphore.make(1);
    const jobs = new Map<string, { fiber: Fiber.Fiber<A, E>; users: number }>();
    const run = <R>(key: string, work: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        lock.withPermit(
          Effect.gen(function* () {
            let job = jobs.get(key);
            if (!job) {
              job = { fiber: yield* work.pipe(Effect.forkIn(scope)), users: 0 };
              jobs.set(key, job);
            }
            job.users++;
            return job;
          }),
        ),
        (job) => Fiber.join(job.fiber),
        (job) =>
          lock.withPermit(
            Effect.gen(function* () {
              if (--job.users === 0) {
                if (jobs.get(key) === job) jobs.delete(key);
                yield* Fiber.interrupt(job.fiber);
              }
            }),
          ),
      );
    return { run };
  });
