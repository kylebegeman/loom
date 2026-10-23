const listeners = new Set<() => void>();

export const onOpenVaultPasswordGenerator = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const openVaultPasswordGenerator = () => {
  for (const listener of listeners) listener();
};
