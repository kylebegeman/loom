import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vite-plus/test";

import {
  createRegexRunner,
  parseRegexWorkerRequest,
  parseRegexWorkerResponse,
  type RegexRunOutcome,
  type RegexWorkerLike,
  type RegexWorkerRequest,
} from "./regexRunner";
import type { RegexMatchResult } from "./tools/regexMatch";

const TIMEOUT_MS = 1000;
const REQUEST = { pattern: "a", flags: "g", text: "aa" };
const RESULT: RegexMatchResult = {
  kind: "ok",
  matches: [{ index: 0, end: 1, value: "a", groups: [], named: {} }],
  truncated: false,
};

class FakeWorker implements RegexWorkerLike {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  readonly posted: Array<RegexWorkerRequest> = [];
  terminated = false;
  failPost = false;

  postMessage(message: RegexWorkerRequest) {
    if (this.failPost) throw new Error("DataCloneError");
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  get lastRequestId() {
    const request = this.posted.at(-1);
    if (!request) throw new Error("Nothing was posted to this worker.");
    return request.requestId;
  }

  reply(result: RegexMatchResult = RESULT, requestId = this.lastRequestId) {
    this.onmessage?.({ data: { requestId, result } });
  }
}

function setup() {
  const workers: Array<FakeWorker> = [];
  const makeWorker = vi.fn(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const runner = createRegexRunner(makeWorker, TIMEOUT_MS);
  const worker = (index: number) => {
    const found = workers[index];
    if (!found) throw new Error(`Worker ${index} was never created.`);
    return found;
  };
  return { runner, makeWorker, workers, worker };
}

const PENDING = "pending";
/** The outcome if the promise has already settled, without waiting for anything else. */
const peek = (promise: Promise<RegexRunOutcome>) =>
  Promise.race([promise, Promise.resolve(PENDING)]);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRegexRunner", () => {
  it("accepts a real worker", () => {
    expectTypeOf<Worker>().toExtend<RegexWorkerLike>();
  });

  it("resolves a request with the worker's reply and reuses the worker", async () => {
    const { runner, makeWorker, worker } = setup();
    const first = runner.run(REQUEST);
    expect(worker(0).posted).toEqual([{ requestId: 1, ...REQUEST }]);
    worker(0).reply();
    await expect(first).resolves.toEqual({ kind: "result", result: RESULT });
    expect(vi.getTimerCount()).toBe(0);

    const second = runner.run({ pattern: "b", flags: "", text: "b" });
    worker(0).reply({ kind: "error", message: "Invalid regular expression: nothing to repeat." });
    await expect(second).resolves.toEqual({
      kind: "result",
      result: { kind: "error", message: "Invalid regular expression: nothing to repeat." },
    });
    expect(makeWorker).toHaveBeenCalledTimes(1);
    expect(worker(0).terminated).toBe(false);
  });

  it("times out, terminates that worker and starts a new one for the next run", async () => {
    const { runner, makeWorker, worker } = setup();
    const stuck = runner.run({ pattern: "(a+)+$", flags: "", text: `${"a".repeat(40)}b` });
    vi.advanceTimersByTime(TIMEOUT_MS - 1);
    expect(await peek(stuck)).toBe(PENDING);
    vi.advanceTimersByTime(1);
    await expect(stuck).resolves.toEqual({ kind: "timeout" });
    expect(worker(0).terminated).toBe(true);
    expect(worker(0).onmessage).toBeNull();

    const next = runner.run(REQUEST);
    expect(makeWorker).toHaveBeenCalledTimes(2);
    worker(1).reply();
    await expect(next).resolves.toEqual({ kind: "result", result: RESULT });
  });

  it("cancels a pending request when a newer one starts, on a fresh worker", async () => {
    const { runner, worker } = setup();
    const older = runner.run(REQUEST);
    const newer = runner.run({ ...REQUEST, text: "aaa" });
    await expect(older).resolves.toEqual({ kind: "cancelled" });
    expect(worker(0).terminated).toBe(true);
    expect(worker(1).posted).toEqual([{ requestId: 2, ...REQUEST, text: "aaa" }]);
    expect(vi.getTimerCount()).toBe(1);

    worker(1).reply();
    await expect(newer).resolves.toEqual({ kind: "result", result: RESULT });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never lets an older deadline terminate a newer request's worker", async () => {
    const { runner, worker } = setup();
    void runner.run(REQUEST);
    vi.advanceTimersByTime(600);
    const newer = runner.run(REQUEST);
    vi.advanceTimersByTime(600);
    expect(await peek(newer)).toBe(PENDING);
    expect(worker(1).terminated).toBe(false);

    vi.advanceTimersByTime(400);
    await expect(newer).resolves.toEqual({ kind: "timeout" });
    expect(worker(1).terminated).toBe(true);
  });

  it("ignores replies from a replaced worker", async () => {
    const { runner, worker } = setup();
    void runner.run(REQUEST);
    // A message the old worker queued before it was terminated.
    const lateDelivery = worker(0).onmessage;
    const newer = runner.run(REQUEST);
    lateDelivery?.({ data: { requestId: 2, result: RESULT } });
    expect(await peek(newer)).toBe(PENDING);

    worker(1).reply({ kind: "ok", matches: [], truncated: false });
    await expect(newer).resolves.toEqual({
      kind: "result",
      result: { kind: "ok", matches: [], truncated: false },
    });
  });

  it("ignores a reply to an earlier request on a reused worker", async () => {
    const { runner, worker } = setup();
    const first = runner.run(REQUEST);
    worker(0).reply();
    await first;

    const second = runner.run(REQUEST);
    worker(0).reply({ kind: "ok", matches: [], truncated: false }, 1);
    expect(await peek(second)).toBe(PENDING);
    worker(0).reply();
    await expect(second).resolves.toEqual({ kind: "result", result: RESULT });
  });

  it("settles the pending request and clears its timer on dispose", async () => {
    const { runner, makeWorker, worker } = setup();
    const pending = runner.run(REQUEST);
    runner.dispose();
    await expect(pending).resolves.toEqual({ kind: "cancelled" });
    expect(worker(0).terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await expect(runner.run(REQUEST)).resolves.toEqual({ kind: "cancelled" });
    expect(makeWorker).toHaveBeenCalledTimes(1);
  });

  it("terminates an idle worker on dispose", async () => {
    const { runner, worker } = setup();
    const done = runner.run(REQUEST);
    worker(0).reply();
    await done;
    runner.dispose();
    expect(worker(0).terminated).toBe(true);
  });

  it("reports a worker that cannot start and tries again on the next run", async () => {
    const { runner, makeWorker, worker } = setup();
    makeWorker.mockImplementationOnce(() => {
      throw new Error("Workers are disabled.");
    });
    await expect(runner.run(REQUEST)).resolves.toEqual({
      kind: "error",
      message: "Could not start the regex worker.",
    });
    expect(vi.getTimerCount()).toBe(0);

    const next = runner.run(REQUEST);
    worker(0).reply();
    await expect(next).resolves.toEqual({ kind: "result", result: RESULT });
  });

  it("reports a request that cannot be sent and uses a new worker next time", async () => {
    const { runner, makeWorker, worker } = setup();
    makeWorker.mockImplementationOnce(() => {
      const broken = new FakeWorker();
      broken.failPost = true;
      return broken;
    });
    await expect(runner.run(REQUEST)).resolves.toEqual({
      kind: "error",
      message: "Could not send the pattern to the regex worker.",
    });
    expect(vi.getTimerCount()).toBe(0);

    const next = runner.run(REQUEST);
    expect(makeWorker).toHaveBeenCalledTimes(2);
    worker(0).reply();
    await expect(next).resolves.toEqual({ kind: "result", result: RESULT });
  });

  it.each([
    ["onerror", "The regex worker stopped unexpectedly."],
    ["onmessageerror", "The regex worker sent a reply that could not be read."],
  ] as const)("recovers from %s on the next request", async (handler, message) => {
    const { runner, makeWorker, worker } = setup();
    const failed = runner.run(REQUEST);
    worker(0)[handler]?.({});
    await expect(failed).resolves.toEqual({ kind: "error", message });
    expect(worker(0).terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const next = runner.run(REQUEST);
    expect(makeWorker).toHaveBeenCalledTimes(2);
    worker(1).reply();
    await expect(next).resolves.toEqual({ kind: "result", result: RESULT });
  });

  it.each([
    ["no envelope", "matches"],
    ["no request id", { result: RESULT }],
    ["a result of the wrong shape", { requestId: 1, result: { kind: "ok", matches: "a" } }],
    [
      "a match of the wrong shape",
      { requestId: 1, result: { kind: "ok", truncated: false, matches: [{ index: "0" }] } },
    ],
  ])("treats a reply with %s as a failure", async (_name, data) => {
    const { runner, makeWorker, worker } = setup();
    const failed = runner.run(REQUEST);
    worker(0).onmessage?.({ data });
    await expect(failed).resolves.toEqual({
      kind: "error",
      message: "The regex worker sent an unexpected reply.",
    });
    expect(worker(0).terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const next = runner.run(REQUEST);
    expect(makeWorker).toHaveBeenCalledTimes(2);
    worker(1).reply();
    await expect(next).resolves.toEqual({ kind: "result", result: RESULT });
  });

  it("drops an idle worker that fails, so the next run starts fresh", async () => {
    const { runner, makeWorker, worker } = setup();
    const done = runner.run(REQUEST);
    worker(0).reply();
    await done;
    worker(0).onerror?.({});
    expect(worker(0).terminated).toBe(true);

    void runner.run(REQUEST);
    expect(makeWorker).toHaveBeenCalledTimes(2);
  });
});

describe("worker envelope", () => {
  it("accepts a reply with group indices and unmatched groups", () => {
    const data = {
      requestId: 3,
      result: {
        kind: "ok",
        truncated: true,
        matches: [
          {
            index: 0,
            end: 2,
            value: "ab",
            groups: ["a", undefined],
            named: { first: "a", second: undefined },
            indices: [[0, 1], undefined],
          },
        ],
      },
    };
    expect(parseRegexWorkerResponse(data)).toEqual(data);
  });

  it("rejects malformed group indices", () => {
    expect(
      parseRegexWorkerResponse({
        requestId: 1,
        result: {
          kind: "ok",
          truncated: false,
          matches: [{ index: 0, end: 1, value: "a", groups: [], named: {}, indices: [[0]] }],
        },
      }),
    ).toBeNull();
  });

  it("reads only whole requests", () => {
    expect(parseRegexWorkerRequest({ requestId: 1, ...REQUEST })).toEqual({
      requestId: 1,
      ...REQUEST,
    });
    expect(parseRegexWorkerRequest({ requestId: "1", ...REQUEST })).toBeNull();
    expect(parseRegexWorkerRequest({ requestId: 1, pattern: "a" })).toBeNull();
    expect(parseRegexWorkerRequest(null)).toBeNull();
  });
});

describe("regex worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers the runner through the shared envelope", async () => {
    const listeners: Array<(event: { readonly data: unknown }) => void> = [];
    const replies: Array<unknown> = [];
    vi.stubGlobal("self", {
      addEventListener: (_type: string, listener: (event: { readonly data: unknown }) => void) =>
        listeners.push(listener),
      postMessage: (message: unknown) => replies.push(message),
    });
    await import("./regexWorker");
    const [listener] = listeners;
    if (!listener) throw new Error("The worker did not listen for messages.");

    // Wires the real worker body to the runner, delivering replies the way a worker would.
    const runner = createRegexRunner(() => {
      const worker: RegexWorkerLike = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage: (message) => {
          listener({ data: message });
          const reply = replies.shift();
          queueMicrotask(() => worker.onmessage?.({ data: reply }));
        },
        terminate: () => undefined,
      };
      return worker;
    }, TIMEOUT_MS);

    await expect(
      runner.run({ pattern: "(\\w+)@(?<host>[\\w.]+)", flags: "g", text: "ada@example.com" }),
    ).resolves.toEqual({
      kind: "result",
      result: {
        kind: "ok",
        truncated: false,
        matches: [
          {
            index: 0,
            end: 15,
            value: "ada@example.com",
            groups: ["ada", "example.com"],
            named: { host: "example.com" },
          },
        ],
      },
    });
    await expect(runner.run({ pattern: "(", flags: "g", text: "a" })).resolves.toEqual({
      kind: "result",
      result: { kind: "error", message: "Invalid regular expression: unterminated group." },
    });

    listener({ data: "not a request" });
    expect(replies).toEqual([]);
  });
});
