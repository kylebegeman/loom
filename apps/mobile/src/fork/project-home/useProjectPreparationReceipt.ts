import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  recordPreparationReceipt,
  settlePreparationReceipt,
  type ProjectPreparationReceipt,
} from "./projectPreparationReceipt";

/** Device preferences survive ordinary offline-cache cleanup and serialize receipt writes. */
export function useProjectPreparationReceipt(key: string | null) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const loaded = AsyncResult.isSuccess(preferences);
  const records = loaded ? preferences.value.loomProjectPreparations : undefined;
  const hasRecord =
    key !== null && records !== undefined && Object.prototype.hasOwnProperty.call(records, key);
  const receipt = hasRecord && key !== null ? (records?.[key] ?? null) : null;
  const invalid = hasRecord && receipt === null;
  const save = useCallback(
    async (next: ProjectPreparationReceipt) => {
      await savePreferences({
        transform: (current) => ({
          loomProjectPreparations: recordPreparationReceipt(current.loomProjectPreparations, next),
        }),
      });
    },
    [savePreferences],
  );
  const settle = useCallback(
    async (next: ProjectPreparationReceipt) => {
      await savePreferences({
        transform: (current) => ({
          loomProjectPreparations: settlePreparationReceipt(current.loomProjectPreparations, next),
        }),
      });
    },
    [savePreferences],
  );
  return { loaded, receipt, invalid, save, settle } as const;
}
