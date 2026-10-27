import { Atom, type AtomRegistry } from "effect/reactivity";
import { environmentThreadShells } from "../../state/threads";
import { setNotificationBadge } from "../../threadNotifications";

const attentionCountAtom = Atom.map(
  environmentThreadShells.attentionThreadShellsAtom,
  (threads) => threads.length,
);

/** Keeps the dock badge on the number of threads that need the user. */
export function startAttentionBadge(registry: AtomRegistry.AtomRegistry): () => void {
  return registry.subscribe(attentionCountAtom, setNotificationBadge, { immediate: true });
}
