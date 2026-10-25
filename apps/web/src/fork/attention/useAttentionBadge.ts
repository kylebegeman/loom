import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { Atom } from "effect/reactivity";
import { environmentThreadShells } from "../../state/threads";
import { setNotificationBadge } from "../../threadNotifications";

const attentionCountAtom = Atom.map(
  environmentThreadShells.attentionThreadShellsAtom,
  (threads) => threads.length,
);

export function useAttentionBadge() {
  const count = useAtomValue(attentionCountAtom);
  useEffect(() => {
    setNotificationBadge(count);
  }, [count]);
}
