import type { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemList, VaultItemPage, VaultItemSummary } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";

export const VAULT_SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 25;
const ARCHIVE_SCAN_PAGES = 4;
const INVENTORY_SCAN_PAGES = Math.ceil(4096 / PAGE_SIZE);
type Target = { readonly environmentId: EnvironmentId; readonly input: VaultItemList };
type Collection = {
  readonly items: ReadonlyArray<VaultItemSummary>;
  readonly nextCursor: string | null;
  readonly total: number;
};

export function createVaultItemCollections<E>(
  list: (target: Target) => Atom.Atom<AsyncResult.AsyncResult<VaultItemPage, E>>,
) {
  const collection = (archived: boolean) => {
    const family = Atom.family((key: string) =>
      Atom.make((get): AsyncResult.AsyncResult<Collection, E | Error> => {
        const target = JSON.parse(key) as Target;
        const items: VaultItemSummary[] = [];
        const seen = new Set<string>();
        let cursor = target.input.cursor;
        let total = 0;
        let archivedCount: number | undefined;
        for (let scan = 0; scan < (archived ? ARCHIVE_SCAN_PAGES : INVENTORY_SCAN_PAGES); scan++) {
          const result = get(list({ ...target, input: { ...target.input, cursor } }));
          if (result._tag === "Failure") return AsyncResult.failure(result.cause);
          if (result._tag !== "Success" || result.waiting) return AsyncResult.initial(true);
          const page = result.value;
          archivedCount = page.archivedCount;
          const matches = archived
            ? page.items.filter((item) => item.state === "archived")
            : page.items;
          total += matches.length;
          const remaining = PAGE_SIZE - items.length;
          const overflow = matches.length > remaining;
          items.push(...matches.slice(0, remaining));
          const next = page.nextCursor;
          if (archived && items.length === PAGE_SIZE)
            return AsyncResult.success({
              items,
              total: page.archivedCount ?? total,
              nextCursor: overflow ? items[PAGE_SIZE - 1]!.id : next,
            });
          if (next === null)
            return AsyncResult.success({
              items,
              nextCursor: null,
              total: archived ? (page.archivedCount ?? total) : total,
            });
          if (seen.has(next) || next === cursor)
            return AsyncResult.failure(
              Cause.fail(new Error("Vault pagination did not advance. Refresh the list.")),
            );
          seen.add(next);
          cursor = next;
        }
        return archived
          ? AsyncResult.success({ items, nextCursor: cursor, total: archivedCount ?? total })
          : AsyncResult.failure(
              Cause.fail(new Error("Vault inventory exceeded its supported page limit.")),
            );
      }),
    );
    return (target: Target) => family(JSON.stringify(target));
  };
  return { archivedPage: collection(true), kindSummary: collection(false) };
}
