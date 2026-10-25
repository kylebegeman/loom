import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { makeRegistry, type ProcessRegistryHost } from "./providerProcesses.ts";

const identity = {
  pid: 123,
  pgid: 123,
  lstart: "Sun Oct 25 12:00:00 2026",
};
const fixture = () => {
  const processes = new Map([[identity.pid, identity]]);
  let file: string | null = null;
  let deny = false;
  const signals: Array<[number, string]> = [];
  const host: ProcessRegistryHost = {
    owner: { ...identity, pid: 456, pgid: 456 },
    inspect: (pid) => processes.get(pid) ?? null,
    members: (pgid) => [...processes.values()].filter((process) => process.pgid === pgid),
    signal: (pgid, signal) => {
      signals.push([pgid, signal]);
      if (deny) throw new Error("denied");
      if (signal === "SIGKILL")
        for (const member of processes.values()) {
          if (member.pgid === pgid) processes.delete(member.pid);
        }
    },
    read: () => file,
    write: (value) => {
      file = value;
    },
  };
  return {
    host,
    processes,
    signals,
    deny: (value: boolean) => {
      deny = value;
    },
    read: () => file,
  };
};

const reap = Effect.fnUntraced(function* (registry: ReturnType<typeof makeRegistry>) {
  const fiber = yield* registry.reap.pipe(Effect.forkChild);
  yield* TestClock.adjust("1 second");
  yield* Fiber.join(fiber);
});

describe("provider process ownership", () => {
  it("signals detached groups synchronously and forgets confirmed exits", () => {
    const f = fixture();
    const registry = makeRegistry(f.host);
    const forget = registry.register({
      pid: 123,
      threadId: "thread",
      nativeSessionId: "native",
      cwd: "/repo",
    });
    expect(JSON.parse(f.read()!).processes[0]).toMatchObject({ ...identity, threadId: "thread" });
    registry.signalAll();
    expect(f.signals).toEqual([[123, "SIGTERM"]]);
    forget();
    registry.signalAll();
    expect(f.signals).toHaveLength(1);
    expect(JSON.parse(f.read()!).processes).toEqual([]);
  });

  it.effect("reaps a previous server's recorded process before allowing continuation", () =>
    Effect.gen(function* () {
      const f = fixture();
      makeRegistry(f.host).register({ pid: 123, threadId: "thread", cwd: "/repo" });
      const restarted = makeRegistry(f.host);
      expect(restarted.blocker("thread")).toBe(123);
      expect(restarted.blocker("another", "/repo")).toBe(123);
      expect(restarted.blocker("another", "/different")).toBeUndefined();
      yield* reap(restarted);
      expect(f.signals).toEqual([
        [123, "SIGTERM"],
        [123, "SIGKILL"],
      ]);
      expect(restarted.blocker("thread")).toBeUndefined();
      expect(JSON.parse(f.read()!).processes).toEqual([]);
    }),
  );

  it.effect("kills a captured plugin child after the original leader exits on TERM", () =>
    Effect.gen(function* () {
      const f = fixture();
      f.processes.set(124, { ...identity, pid: 124 });
      makeRegistry(f.host).register({ pid: 123, threadId: "thread" });
      const restarted = makeRegistry({
        ...f.host,
        signal: (pgid, signal) => {
          f.host.signal(pgid, signal);
          if (signal === "SIGTERM") f.processes.delete(123);
        },
      });
      yield* reap(restarted);
      expect(f.signals).toEqual([
        [123, "SIGTERM"],
        [123, "SIGKILL"],
      ]);
      expect(f.processes.size).toBe(0);
      expect(restarted.blocker("thread")).toBeUndefined();
    }),
  );

  it.effect("never signals a recycled PID or a changed process group", () =>
    Effect.gen(function* () {
      for (const changed of [{ lstart: "later" }, { pgid: 987 }]) {
        const f = fixture();
        makeRegistry(f.host).register({ pid: 123, threadId: "thread" });
        f.processes.set(123, { ...identity, ...changed });
        const restarted = makeRegistry(f.host);
        yield* reap(restarted);
        expect(f.signals).toEqual([]);
        expect(restarted.blocker("thread")).toBe("lstart" in changed ? undefined : 123);
      }
    }),
  );

  it.effect("keeps an unkillable provider blocked and retries Stop", () =>
    Effect.gen(function* () {
      const f = fixture();
      makeRegistry(f.host).register({ pid: 123, threadId: "thread" });
      f.deny(true);
      const restarted = makeRegistry(f.host);
      yield* reap(restarted);
      expect(restarted.blocker("thread")).toBe(123);
      f.deny(false);
      const fiber = yield* restarted.stop("thread").pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(fiber);
      expect(restarted.blocker("thread")).toBeUndefined();
    }),
  );

  it.effect("does not reap providers belonging to a still-running server", () =>
    Effect.gen(function* () {
      const f = fixture();
      makeRegistry(f.host).register({ pid: 123, threadId: "thread" });
      f.processes.set(f.host.owner.pid, f.host.owner);
      const restarted = makeRegistry({ ...f.host, owner: { ...identity, pid: 789, pgid: 789 } });
      yield* reap(restarted);
      expect(f.signals).toEqual([]);
      expect(restarted.blocker("thread")).toBe(123);
    }),
  );

  it("blocks all continuations for a surviving shared provider", () => {
    const f = fixture();
    makeRegistry(f.host).register({ pid: 123 });
    expect(makeRegistry(f.host).blocker("any-thread")).toBe(123);
  });

  it.effect("Stop clears a block another thread's provider holds on the same folder", () =>
    Effect.gen(function* () {
      const f = fixture();
      makeRegistry(f.host).register({ pid: 123, threadId: "other", cwd: "/repo" });
      f.deny(true);
      const restarted = makeRegistry(f.host);
      yield* reap(restarted);
      expect(restarted.blocker("thread", "/repo")).toBe(123);
      f.deny(false);
      const fiber = yield* restarted.stop("thread", "/repo").pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(fiber);
      expect(restarted.blocker("thread", "/repo")).toBeUndefined();
    }),
  );

  it("starts without previous records when the ownership ledger is unreadable", () => {
    const f = fixture();
    const unreadable: Array<unknown> = [];
    const registry = makeRegistry({ ...f.host, read: () => "{" }, (cause) => {
      unreadable.push(cause);
    });
    expect(unreadable).toHaveLength(1);
    expect(registry.blocker("thread")).toBeUndefined();
    registry.register({ pid: 123, threadId: "thread" });
    expect(JSON.parse(f.read()!).processes).toHaveLength(1);
  });

  it("kills an acquired process if its ownership cannot be persisted", () => {
    const f = fixture();
    const registry = makeRegistry({
      ...f.host,
      write: () => {
        throw new Error("disk full");
      },
    });
    expect(() => registry.register({ pid: 123 })).toThrow("disk full");
    expect(f.signals).toEqual([[123, "SIGKILL"]]);
  });
});
