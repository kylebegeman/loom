import { Atom, type AtomRegistry } from "effect/reactivity";
import { environmentThreadShells } from "../../state/threads";
import { setNotificationBadge } from "../../threadNotifications";

const attentionCountAtom = Atom.map(
  environmentThreadShells.attentionThreadShellsAtom,
  (threads) => threads.length,
);

/** Badges the threads that need the user, whatever the notification mode. */
export function startAttentionBadge(registry: AtomRegistry.AtomRegistry): () => void {
  return registry.subscribe(attentionCountAtom, setNotificationBadge, { immediate: true });
}
