import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  encodeSubmittedLibraryProjectRequest,
  readSubmittedLibraryProjectRequest,
  type SubmittedLibraryProjectRequest,
} from "./libraryProjectRequest";

export function useLibraryProjectRequest(key: string) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const loaded = AsyncResult.isSuccess(preferences);
  const saved = readSubmittedLibraryProjectRequest(
    loaded ? preferences.value.loomLibraryLaunches?.[key] : undefined,
  );
  const [current, setCurrent] = useState<{
    key: string;
    value: SubmittedLibraryProjectRequest | null;
  } | null>(null);
  const attempt = current?.key === key ? current.value : saved;
  async function persist(next: SubmittedLibraryProjectRequest | null) {
    const encoded = next ? encodeSubmittedLibraryProjectRequest(next) : null;
    if (encoded && encoded.length > 256 * 1024)
      throw new Error("This request is too large to preserve safely on this device.");
    await save({
      transform: (values) => {
        const requests = { ...values.loomLibraryLaunches };
        if (encoded) requests[key] = encoded;
        else delete requests[key];
        return { loomLibraryLaunches: requests };
      },
    });
    setCurrent({ key, value: next });
  }
  return { loaded, attempt, persist };
}
