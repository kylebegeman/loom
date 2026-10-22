import { describe, expect, it } from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { makeWaitingBotRunsAtom, waitingBotRunThreads } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

type WaitingShell = EnvironmentThreadShell & { readonly pendingRuntimeRequestAt?: string | null };
const shell = (fields: Partial<WaitingShell> = {}): WaitingShell =>
  ({
    environmentId: EnvironmentId.make("test"),
    id: ThreadId.make("bot-run-one"),
    title: "Reviewer",
    hasPendingApprovals: true,
    hasPendingUserInput: false,
    archivedAt: null,
    pendingRuntimeRequestAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:01:00.000Z",
    ...fields,
  }) as WaitingShell;

describe("waiting bot inbox", () => {
  it("retains request time separately from later thread activity and supports older shells", () => {
    const [waiting] = waitingBotRunThreads([shell()]);
    expect(waiting?.waitingSince).toBe("2026-10-20T10:00:00.000Z");
    expect(waiting?.updatedAt).toBe("2026-10-20T10:01:00.000Z");
    expect(
      waitingBotRunThreads([shell({ pendingRuntimeRequestAt: null })])[0]?.waitingSince,
    ).toBeNull();
  });

  it("publishes replacement requests and environment changes without rerendering for unrelated shell edits", () => {
    const original = shell();
    const source = Atom.make<ReadonlyArray<WaitingShell>>([original]);
    const waiting = makeWaitingBotRunsAtom(source);
    const registry = AtomRegistry.make();
    const unsubscribe = registry.subscribe(waiting, () => {});
    const first = registry.get(waiting);
    registry.set(source, [{ ...original, visibleItemCount: 4 }]);
    expect(registry.get(waiting)).toBe(first);
    registry.set(source, [{ ...original, pendingRuntimeRequestAt: "2026-10-20T10:02:00.000Z" }]);
    expect(registry.get(waiting)[0]?.waitingSince).toBe("2026-10-20T10:02:00.000Z");
    registry.set(source, [{ ...original, updatedAt: "2026-10-20T10:03:00.000Z" }]);
    expect(registry.get(waiting)[0]?.updatedAt).toBe("2026-10-20T10:03:00.000Z");
    registry.set(source, [{ ...original, environmentId: EnvironmentId.make("another") }]);
    expect(registry.get(waiting)[0]?.environmentId).toBe("another");
    registry.set(source, [{ ...original, hasPendingApprovals: false }]);
    expect(registry.get(waiting)).toEqual([]);
    unsubscribe();
    registry.dispose();
  });
});
