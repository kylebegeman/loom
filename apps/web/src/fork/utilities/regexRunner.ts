import type { RegexMatch, RegexMatchResult } from "./tools/regexMatch";

/** How long one match may run before its worker is terminated. */
export const REGEX_TIMEOUT_MS = 1000;

export interface RegexWorkerRequest {
  readonly requestId: number;
  readonly pattern: string;
  readonly flags: string;
  readonly text: string;
}

/** The only message the worker posts back. Timeout and cancellation are runner outcomes. */
export interface RegexWorkerResponse {
  readonly requestId: number;
  readonly result: RegexMatchResult;
}

// Method syntax makes the parameter bivariant. A DOM `Worker`'s handlers take a full
// `MessageEvent` or `ErrorEvent`, so with a plain function type it would not be assignable.
type WorkerHandler<Event> = { handle(event: Event): void }["handle"];

/** The part of `Worker` the runner uses, so tests can drive it with a plain object. */
export interface RegexWorkerLike {
  postMessage(message: RegexWorkerRequest): void;
  terminate(): void;
  onmessage: WorkerHandler<{ readonly data: unknown }> | null;
  onerror: WorkerHandler<unknown> | null;
  onmessageerror: WorkerHandler<unknown> | null;
}

export type RegexRunOutcome =
  | { readonly kind: "result"; readonly result: RegexMatchResult }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly message: string };

export interface RegexRunner {
  /** Settles any earlier request as cancelled; only the newest request can produce a result. */
  run(request: {
    readonly pattern: string;
    readonly flags: string;
    readonly text: string;
  }): Promise<RegexRunOutcome>;
  /** Cancels the pending request and terminates the worker; later runs resolve "cancelled". */
  dispose(): void;
}

const CANCELLED: RegexRunOutcome = { kind: "cancelled" };
const TIMEOUT: RegexRunOutcome = { kind: "timeout" };
const failure = (message: string): RegexRunOutcome => ({ kind: "error", message });

interface ActiveRequest {
  readonly id: number;
  readonly worker: RegexWorkerLike;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (outcome: RegexRunOutcome) => void;
}

/**
 * Runs one match at a time in a worker. A synchronous `RegExp` cannot be interrupted, so the
 * deadline is enforced by terminating the worker; the next run starts a fresh one.
 */
export function createRegexRunner(
  makeWorker: () => RegexWorkerLike,
  timeoutMs: number,
): RegexRunner {
  let worker: RegexWorkerLike | null = null;
  let active: ActiveRequest | null = null;
  let lastId = 0;
  let disposed = false;

  const retire = (retired: RegexWorkerLike) => {
    if (worker === retired) worker = null;
    retired.onmessage = null;
    retired.onerror = null;
    retired.onmessageerror = null;
    try {
      retired.terminate();
    } catch {
      // Already unusable; dropping every reference to it is all that is left to do.
    }
  };

  // The single exit for a request. Checking the id makes a late timer or a stale reply a no-op,
  // and only the request's own worker is ever retired, never a newer one.
  const settle = (id: number, outcome: RegexRunOutcome, keepWorker: boolean) => {
    const request = active;
    if (!request || request.id !== id) return;
    active = null;
    clearTimeout(request.timer);
    if (!keepWorker) retire(request.worker);
    request.resolve(outcome);
  };

  const fail = (failed: RegexWorkerLike, message: string) => {
    if (active?.worker === failed) settle(active.id, failure(message), false);
    else if (worker === failed) retire(failed);
  };

  const startWorker = () => {
    const started = makeWorker();
    started.onmessage = (event) => {
      const request = active;
      if (request?.worker !== started) return;
      const response = parseRegexWorkerResponse(event.data);
      if (!response) {
        settle(request.id, failure("The regex worker sent an unexpected reply."), false);
        return;
      }
      settle(response.requestId, { kind: "result", result: response.result }, true);
    };
    started.onerror = () => fail(started, "The regex worker stopped unexpectedly.");
    started.onmessageerror = () =>
      fail(started, "The regex worker sent a reply that could not be read.");
    return started;
  };

  return {
    run: ({ pattern, flags, text }) =>
      new Promise((resolve) => {
        if (disposed) {
          resolve(CANCELLED);
          return;
        }
        // Superseding terminates the busy worker: it may be stuck in the old pattern.
        if (active) settle(active.id, CANCELLED, false);
        const id = ++lastId;
        let current = worker;
        if (!current) {
          try {
            current = startWorker();
          } catch {
            resolve(failure("Could not start the regex worker."));
            return;
          }
          worker = current;
        }
        const timer = setTimeout(() => settle(id, TIMEOUT, false), timeoutMs);
        active = { id, worker: current, timer, resolve };
        try {
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Dedicated workers do not accept a target origin.
          current.postMessage({ requestId: id, pattern, flags, text });
        } catch {
          settle(id, failure("Could not send the pattern to the regex worker."), false);
        }
      }),
    dispose: () => {
      disposed = true;
      if (active) settle(active.id, CANCELLED, false);
      if (worker) retire(worker);
    },
  };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isArrayOf = <T>(
  value: unknown,
  isItem: (item: unknown) => item is T,
): value is ReadonlyArray<T> => Array.isArray(value) && value.every(isItem);

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isOptionalSpan = (value: unknown): value is readonly [number, number] | undefined =>
  value === undefined ||
  (isArrayOf(value, (item) => typeof item === "number") && value.length === 2);

function isRegexMatch(value: unknown): value is RegexMatch {
  return (
    isRecord(value) &&
    typeof value.index === "number" &&
    typeof value.end === "number" &&
    typeof value.value === "string" &&
    isArrayOf(value.groups, isOptionalString) &&
    isRecord(value.named) &&
    Object.values(value.named).every(isOptionalString) &&
    (!("indices" in value) || isArrayOf(value.indices, isOptionalSpan))
  );
}

function isRegexMatchResult(value: unknown): value is RegexMatchResult {
  if (!isRecord(value)) return false;
  if (value.kind === "error") return typeof value.message === "string";
  return (
    value.kind === "ok" &&
    typeof value.truncated === "boolean" &&
    isArrayOf(value.matches, isRegexMatch)
  );
}

/** The worker's reply, or null when it does not have the envelope's shape. */
export function parseRegexWorkerResponse(data: unknown): RegexWorkerResponse | null {
  if (!isRecord(data)) return null;
  const { requestId, result } = data;
  if (typeof requestId !== "number" || !isRegexMatchResult(result)) return null;
  return { requestId, result };
}

/** The runner's request, or null when the message is anything else. */
export function parseRegexWorkerRequest(data: unknown): RegexWorkerRequest | null {
  if (!isRecord(data)) return null;
  const { requestId, pattern, flags, text } = data;
  if (typeof requestId !== "number") return null;
  if (typeof pattern !== "string" || typeof flags !== "string" || typeof text !== "string")
    return null;
  return { requestId, pattern, flags, text };
}
