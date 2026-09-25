import type { ForkKeybindingCommand } from "@t3tools/contracts/fork";

const listeners = new Map<ForkKeybindingCommand, Set<() => void>>();

/** Subscribe to a fork command from a shortcut or palette item. Returns the unsubscribe. */
export function onForkCommand(command: ForkKeybindingCommand, listener: () => void): () => void {
  const set = listeners.get(command) ?? new Set();
  set.add(listener);
  listeners.set(command, set);
  return () => set.delete(listener);
}

/** Runs every listener; false when nothing handles the command (the key then falls through). */
export function dispatchForkCommand(command: ForkKeybindingCommand): boolean {
  const set = listeners.get(command);
  if (!set || set.size === 0) return false;
  for (const listener of set) listener();
  return true;
}
