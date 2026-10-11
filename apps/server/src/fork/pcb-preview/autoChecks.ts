import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type {
  PcbCheckActivity,
  PcbAutoCheckKind,
  PcbReviewResult,
  PcbCheckResult,
  PcbPreviewError,
  PcbCheckKind,
} from "@t3tools/contracts/fork";

export const AUTO_CHECK_DEBOUNCE = "2 seconds";
export const AUTO_CHECK_TIMEOUT = "120 seconds";
export const AUTO_CHECK_MAX_MS = 60_000;

/** One host-owned worker avoids duplicate client runs. New saves cancel obsolete work; closing
 * the last watcher releases its process. Slow checks pause and failures wait for another save. */
export const makeAutoChecks = <D, K extends PcbAutoCheckKind = PcbCheckKind>(deps: {
  kinds?: readonly K[];
  key: (design: D) => string;
  project: (design: D) => string;
  available: (design: D, kind: K) => boolean;
  settings: (project: string) => Effect.Effect<{ autoChecks: Partial<Record<K, boolean>> }>;
  snapshot: (design: D) => Effect.Effect<string, PcbPreviewError>;
  stored: (design: D, kind: K) => Effect.Effect<PcbCheckResult | PcbReviewResult | null>;
  fresh?: (design: D, kind: K, stored: PcbCheckResult | PcbReviewResult) => Effect.Effect<boolean>;
  run: (
    design: D,
    kind: K,
    trigger: "auto" | "manual",
  ) => Effect.Effect<PcbCheckResult | PcbReviewResult, PcbPreviewError>;
}) =>
  Effect.gen(function* () {
    const KINDS = deps.kinds ?? (["erc", "drc"] as K[]);
    const scope = yield* Effect.scope;
    const permit = yield* Semaphore.make(1);
    const manualPermit = yield* Semaphore.make(1);
    const transitions = yield* Semaphore.make(1);
    const bus = yield* PubSub.sliding<string>(64);
    type State = {
      design: D;
      watchers: number;
      requests: number;
      hash: string | null;
      pending: Fiber.Fiber<void> | null;
      pendingHash: string | null;
      running: PcbCheckActivity["running"];
      manual: Set<K>;
      paused: Map<K, PcbCheckActivity["paused"][number] & { hash: string }>;
    };
    const states = new Map<string, State>();
    const state = (design: D) => {
      const key = deps.key(design);
      let value = states.get(key);
      if (!value) {
        value = {
          design,
          watchers: 0,
          requests: 0,
          hash: null,
          pending: null,
          pendingHash: null,
          running: null,
          manual: new Set(),
          paused: new Map(),
        };
        states.set(key, value);
      }
      value.design = design;
      return value;
    };
    const changed = (key: string) => PubSub.publish(bus, key).pipe(Effect.asVoid);
    const activity = (design: D) =>
      Effect.gen(function* () {
        const current = states.get(deps.key(design));
        const review = KINDS.includes("review" as K)
          ? yield* deps.stored(design, "review" as K)
          : null;
        const erc = yield* deps.stored(design, "erc" as K),
          drc = yield* deps.stored(design, "drc" as K);
        return {
          running: current?.running ?? null,
          paused: [...(current?.paused.values() ?? [])].map((pause) => ({
            kind: pause.kind,
            reason: pause.reason,
            ...(pause.durationMs !== undefined ? { durationMs: pause.durationMs } : {}),
          })),
          ranAt: {
            ...(review ? { review: review.ranAt } : {}),
            ...(erc ? { erc: erc.ranAt } : {}),
            ...(drc ? { drc: drc.ranAt } : {}),
          },
        } satisfies PcbCheckActivity;
      });
    const stop = (s: State) =>
      Effect.gen(function* () {
        const old = s.pending;
        s.pending = null;
        s.pendingHash = null;
        if (old) yield* Fiber.interrupt(old);
      });
    const notify = (design: D, hash: string, immediate = false, force = false) =>
      transitions.withPermit(
        Effect.gen(function* () {
          const s = state(design),
            key = deps.key(design);
          s.hash = hash;
          if (!force && s.pending && s.pendingHash === hash) return s.pending;
          yield* stop(s);
          if (s.watchers + s.requests === 0 || s.manual.size) return null;
          const settings = yield* deps.settings(deps.project(design));
          if (!KINDS.some((kind) => settings.autoChecks[kind] && deps.available(design, kind)))
            return null;
          s.pendingHash = hash;
          const work = Effect.gen(function* () {
            if (!immediate) yield* Effect.sleep(AUTO_CHECK_DEBOUNCE);
            yield* permit.withPermit(
              Effect.gen(function* () {
                for (const kind of KINDS) {
                  const settings = yield* deps.settings(deps.project(s.design));
                  const pause = s.paused.get(kind);
                  if (
                    !settings.autoChecks[kind] ||
                    !deps.available(s.design, kind) ||
                    s.manual.size ||
                    (pause && (pause.reason === "slow" || pause.hash === hash))
                  )
                    continue;
                  const stored = yield* deps.stored(s.design, kind);
                  if (
                    stored?.sourceHash === hash &&
                    (!deps.fresh || (yield* deps.fresh(s.design, kind, stored)))
                  )
                    continue;
                  if ((yield* deps.snapshot(s.design)) !== hash) return;
                  s.paused.delete(kind);
                  s.running = { kind, trigger: "auto", sourceHash: hash };
                  yield* changed(key);
                  yield* deps.run(s.design, kind, "auto").pipe(
                    Effect.tap((result) =>
                      Effect.sync(() => {
                        if ((result.durationMs ?? 0) > AUTO_CHECK_MAX_MS)
                          s.paused.set(kind, {
                            kind,
                            reason: "slow",
                            hash,
                            durationMs: result.durationMs,
                          });
                        else if (result.outcome === "failed" || result.outcome === "timed-out")
                          s.paused.set(kind, {
                            kind,
                            reason: "failed",
                            hash,
                            ...(result.durationMs !== undefined
                              ? { durationMs: result.durationMs }
                              : {}),
                          });
                      }),
                    ),
                    Effect.catch(() =>
                      Effect.sync(() => {
                        s.paused.set(kind, { kind, reason: "failed", hash });
                      }),
                    ),
                    Effect.ensuring(
                      Effect.gen(function* () {
                        s.running = null;
                        yield* changed(key);
                      }),
                    ),
                  );
                }
              }),
            );
          }).pipe(Effect.catch(() => Effect.void));
          // Pending identity remains until replaced, so clients joining the same hash share the job.
          const fiber = yield* work.pipe(Effect.forkIn(scope));
          s.pending = fiber;
          return fiber;
        }),
      );
    const watching = (design: D) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          state(design).watchers++;
        }),
        () =>
          transitions.withPermit(
            Effect.gen(function* () {
              const s = state(design);
              s.watchers--;
              if (s.watchers + s.requests === 0) {
                yield* stop(s);
                if (s.manual.size === 0) states.delete(deps.key(design));
                yield* changed(deps.key(design));
              }
            }),
          ),
      );
    const manual = (design: D, kind: K) =>
      manualPermit.withPermit(
        Effect.gen(function* () {
          const s = state(design),
            key = deps.key(design);
          yield* transitions.withPermit(
            Effect.gen(function* () {
              s.manual.add(kind);
              yield* stop(s);
            }),
          );
          return yield* Effect.gen(function* () {
            const hash = yield* deps.snapshot(design);
            s.running = { kind, trigger: "manual", sourceHash: hash };
            yield* changed(key);
            return yield* deps.run(design, kind, "manual").pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  if ((result.durationMs ?? 0) <= AUTO_CHECK_MAX_MS) s.paused.delete(kind);
                }),
              ),
            );
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                s.manual.delete(kind);
                s.running = null;
                yield* changed(key);
                if (s.hash) yield* notify(design, s.hash, false, true);
              }),
            ),
          );
        }),
      );
    const ensureFresh = (design: D) =>
      Effect.gen(function* () {
        yield* manualPermit.withPermit(Effect.void);
        const s = state(design);
        s.requests++;
        yield* Effect.gen(function* () {
          const hash = yield* deps.snapshot(design);
          const pending = yield* notify(design, hash, true);
          if (pending) yield* Fiber.join(pending);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              s.requests--;
              if (!s.watchers && !s.requests && !s.manual.size) states.delete(deps.key(design));
            }),
          ),
        );
      });
    const settingsChanged = (project: string) =>
      Effect.forEach(
        [...states.values()].filter((s) => deps.project(s.design) === project && s.watchers),
        (s) => (s.hash ? notify(s.design, s.hash, false, true) : Effect.void),
        { discard: true },
      );
    const events = (design: D) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(bus);
          return Stream.concat(
            Stream.fromEffect(activity(design)),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((key) => key === deps.key(design)),
              Stream.mapEffect(() => activity(design)),
            ),
          ).pipe(Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)));
        }),
      );
    return { watching, notify, manual, ensureFresh, settingsChanged, events, changed };
  });
