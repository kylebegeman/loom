import { Atom, type AtomRegistry } from "effect/reactivity";
import { environmentThreadShells } from "../../state/threads";
import { setNotificationBadge } from "../../threadNotifications";

/** The dock badge counts threads waiting on the user, not the notifications still on screen. */
export function startAttentionBadge(registry: AtomRegistry.AtomRegistry): () => void {
  const attentionCount = Atom.map(
    environmentThreadShells.attentionThreadShellsAtom,
    (threads) => threads.length,
  );
  return registry.subscribe(attentionCount, setNotificationBadge, { immediate: true });
}
