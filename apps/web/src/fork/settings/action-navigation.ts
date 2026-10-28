export type SettingsActionTarget = "fleet-updates" | "library-push" | "published-pages";

const listeners = new Set<(target: SettingsActionTarget) => void>();

export function onOpenSettingsAction(listener: (target: SettingsActionTarget) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openSettingsAction(target: SettingsActionTarget) {
  for (const listener of listeners) listener(target);
}
