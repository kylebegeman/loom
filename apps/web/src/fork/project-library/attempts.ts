import * as Schema from "effect/Schema";
import { useCallback, useMemo, useSyncExternalStore } from "react";

const memory = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();
type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem" | "removeItem">;

export function readLibraryAttempt(key: string, storage: ReadStorage | null) {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/** Preserve the operation identity in memory even when browser persistence is unavailable. */
export function saveLibraryAttempt(
  key: string,
  serialized: string | null,
  storage: WriteStorage | null,
) {
  memory.set(key, serialized);
  try {
    if (serialized === null) storage?.removeItem(key);
    else storage?.setItem(key, serialized);
  } catch {
    /* The request remains recoverable while this client stays open. */
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

function clientStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Save before dispatch and clear only after both execution host and Library acknowledge. */
export function useLibraryAttempt<A, E>(key: string, schema: Schema.Codec<A, E>) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const current = listeners.get(key) ?? new Set<() => void>();
      current.add(listener);
      listeners.set(key, current);
      const changed = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return;
        memory.set(key, event.newValue);
        listener();
      };
      window.addEventListener("storage", changed);
      return () => {
        current.delete(listener);
        window.removeEventListener("storage", changed);
      };
    },
    [key],
  );
  const snapshot = useCallback(() => readLibraryAttempt(key, clientStorage()), [key]);
  const serialized = useSyncExternalStore(subscribe, snapshot, () => null);
  const attempt = useMemo(() => {
    if (serialized === null) return null;
    try {
      return Schema.decodeSync(Schema.fromJsonString(schema))(serialized);
    } catch {
      return null;
    }
  }, [schema, serialized]);
  const save = useCallback(
    (value: A | null) =>
      saveLibraryAttempt(
        key,
        value === null ? null : Schema.encodeSync(Schema.fromJsonString(schema))(value),
        clientStorage(),
      ),
    [key, schema],
  );
  return [attempt, save] as const;
}
