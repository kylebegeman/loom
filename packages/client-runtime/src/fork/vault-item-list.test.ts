import { EnvironmentId } from "@t3tools/contracts";
import type { VaultItemPage, VaultItemSummary } from "@t3tools/contracts/fork";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { createVaultItemCollections } from "./vault-item-list.ts";

const item = (index: number, state: "active" | "archived"): VaultItemSummary => ({
  id: index.toString(16).padStart(32, "0"),
  label: `Item ${index}`,
  kind: "secret",
  state,
  version: 1,
  createdAt: "2026-10-28T00:00:00Z",
  updatedAt: "2026-10-28T00:00:00Z",
});
const target = {
  environmentId: EnvironmentId.make("synthetic-vault"),
  input: { cursor: null, includeArchived: true, sort: "label" as const },
};

it("fills an archive page without dropping overflow and stops sparse scans after four pages", () => {
  const pages = [
    Array.from({ length: 25 }, (_, index) => item(index, index < 10 ? "archived" : "active")),
    Array.from({ length: 25 }, (_, index) => item(index + 25, "archived")),
  ];
  let calls = 0;
  const collections = createVaultItemCollections(() => {
    const index = calls++;
    return Atom.make(
      AsyncResult.success({
        items: pages[index]!,
        nextCursor: index === 0 ? item(24, "active").id : null,
      }),
    );
  });
  const registry = AtomRegistry.make();
  try {
    const result = registry.get(collections.archivedPage(target));
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(result.value.items).toHaveLength(25);
    expect(result.value.nextCursor).toBe(item(39, "archived").id);
    expect(calls).toBe(2);
    calls = 0;
    const sparse = createVaultItemCollections(({ input }) => {
      calls++;
      const next = String(Number(input.cursor ?? 0) + 1).padStart(32, "0");
      return Atom.make(AsyncResult.success({ items: [], nextCursor: next }));
    });
    const empty = registry.get(sparse.archivedPage(target));
    expect(empty._tag).toBe("Success");
    if (empty._tag === "Success") expect(empty.value.nextCursor).toBe("4".padStart(32, "0"));
    expect(calls).toBe(4);
  } finally {
    registry.dispose();
  }
});

it("counts all matching kind pages while retaining at most 25 rows and refuses cursor cycles", () => {
  const collections = createVaultItemCollections(({ input }) =>
    Atom.make(
      AsyncResult.success({
        items: Array.from({ length: 25 }, (_, index) =>
          item(index + (input.cursor ? 25 : 0), "active"),
        ),
        nextCursor: input.cursor ? null : item(24, "active").id,
        archivedCount: 0,
      }),
    ),
  );
  const registry = AtomRegistry.make();
  try {
    const result = registry.get(collections.kindSummary(target));
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(result.value.total).toBe(50);
    expect(result.value.items).toHaveLength(25);
    const cyclic = createVaultItemCollections(() =>
      Atom.make(
        AsyncResult.success<VaultItemPage>({ items: [], nextCursor: item(1, "active").id }),
      ),
    );
    const failure = registry.get(cyclic.kindSummary(target));
    expect(failure._tag).toBe("Failure");
  } finally {
    registry.dispose();
  }
});
