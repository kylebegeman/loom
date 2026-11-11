import { AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const { badge, attentionAtom } = await vi.hoisted(async () => {
  const { Atom } = await import("effect/reactivity");
  return { badge: vi.fn(), attentionAtom: Atom.make<readonly object[]>([]) };
});
vi.mock(import("../../threadNotifications"), () => ({ setNotificationBadge: badge }) as never);
vi.mock(
  import("../../state/threads"),
  () =>
    ({
      environmentThreadShells: { attentionThreadShellsAtom: attentionAtom },
    }) as never,
);

import { startAttentionBadge } from "./attentionBadge";

it("replaces stale badges at startup, follows resolved attention and clears on shutdown", () => {
  badge.mockClear();
  using cleanup = new DisposableStack();
  const registry = AtomRegistry.make();
  cleanup.defer(() => registry.dispose());
  const stop = startAttentionBadge(registry);
  cleanup.defer(stop);
  expect(badge).toHaveBeenLastCalledWith(0);
  registry.set(attentionAtom, [{}]);
  expect(badge).toHaveBeenLastCalledWith(1);
  registry.set(attentionAtom, []);
  expect(badge).toHaveBeenLastCalledWith(0);
  registry.set(attentionAtom, [{}, {}]);
  expect(badge).toHaveBeenLastCalledWith(2);
  stop();
  expect(badge).toHaveBeenLastCalledWith(0);
  registry.set(attentionAtom, [{}]);
  expect(badge).toHaveBeenLastCalledWith(0);
});
