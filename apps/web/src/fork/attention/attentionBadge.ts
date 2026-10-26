import { Atom, type AtomRegistry } from "effect/reactivity";
import { environmentThreadShells } from "../../state/threads";
import { setNotificationBadge } from "../../threadNotifications";

const attentionCountAtom = Atom.map(
  environmentThreadShells.attentionThreadShellsAtom,
  (threads) => threads.length,
);

/** Badges the dock with the threads that need attention, whether or not alerts are on. */
export function startAttentionBadge(registry: AtomRegistry.AtomRegistry): () => void {
  return registry.subscribe(attentionCountAtom, setNotificationBadge, { immediate: true });
}
