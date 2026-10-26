import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

const PreparationAttempt = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  repositoryKey: Schema.String,
  remoteUrl: Schema.String,
  /** Absent until a computer that chooses its own folder reports the one it used. */
  destinationPath: Schema.optional(Schema.String),
  title: Schema.String,
  createdAt: Schema.String,
});
export type PreparationAttempt = typeof PreparationAttempt.Type;
const decodeAttempt = Schema.decodeUnknownOption(Schema.fromJsonString(PreparationAttempt));
const memoryAttempts = new Map<string, PreparationAttempt | null>();
const listeners = new Map<string, Set<() => void>>();

export function readPreparationAttempt(
  key: string,
  storage: Pick<Storage, "getItem"> | null,
): PreparationAttempt | null {
  if (memoryAttempts.has(key)) return memoryAttempts.get(key) ?? null;
  try {
    const serialized = storage?.getItem(key);
    if (serialized) {
      const decoded = decodeAttempt(serialized);
      if (Option.isSome(decoded)) return decoded.value;
    }
  } catch {
    /* Keep the submitted ID recoverable for this client when storage is blocked. */
  }
  return memoryAttempts.get(key) ?? null;
}

export function savePreparationAttempt(
  key: string,
  attempt: PreparationAttempt | null,
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
) {
  // A failed write or removal can leave an older receipt in storage. Keep completions too,
  // so that stale receipt cannot replace the request the client actually submitted.
  memoryAttempts.set(key, attempt);
  try {
    if (attempt) storage?.setItem(key, JSON.stringify(attempt));
    else storage?.removeItem(key);
  } catch {
    /* The in-memory receipt still prevents duplicate requests until this client closes. */
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

export function readCurrentPreparationAttempt(sourceKey: string) {
  return readPreparationAttempt(`loom:project-preparation:${sourceKey}`, clientStorage());
}

/** Save the request before dispatch. Losing a response must not mint another project ID. */
export function useProjectPreparationAttempt(sourceKey: string) {
  const key = `loom:project-preparation:${sourceKey}`;
  const getSnapshot = useCallback(() => {
    const attempt = readPreparationAttempt(key, clientStorage());
    return attempt ? JSON.stringify(attempt) : null;
  }, [key]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const current = listeners.get(key) ?? new Set<() => void>();
      current.add(listener);
      listeners.set(key, current);
      const changed = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return;
        const decoded = decodeAttempt(event.newValue);
        if (Option.isSome(decoded)) memoryAttempts.set(key, decoded.value);
        else memoryAttempts.set(key, null);
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
  const serialized = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const attempt = useMemo(() => {
    const decoded = decodeAttempt(serialized);
    return Option.getOrNull(decoded);
  }, [serialized]);
  const saveAttempt = useCallback(
    (next: PreparationAttempt | null) => {
      savePreparationAttempt(key, next, clientStorage());
    },
    [key],
  );
  return [attempt, saveAttempt] as const;
}
