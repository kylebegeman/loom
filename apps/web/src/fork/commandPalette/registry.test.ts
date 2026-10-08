import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { filterCommandPaletteGroups } from "~/components/CommandPalette.logic";
import { FORK_COMMAND_PALETTE_SOURCES, forkCommandPaletteItems } from "./registry";

// Every source with its feature on and a thread open, so each lists all of its items.
const context = {
  activeThreadRef: scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1")),
  loomFeatures: ["core", ...FORK_COMMAND_PALETTE_SOURCES.map((source) => source.id)],
};

describe("fork command palette sources", () => {
  it.each(["model-preview-3d", "pcb-preview"])(
    "hides %s actions without the environment feature or an active thread",
    (id) => {
      const source = FORK_COMMAND_PALETTE_SOURCES.find((item) => item.id === id)!;
      expect(source.items({ ...context, loomFeatures: [] })).toEqual([]);
      expect(source.items({ ...context, activeThreadRef: null })).toEqual([]);
      expect(source.items(context).length).toBeGreaterThan(0);
    },
  );

  it("find every item by its title", () => {
    const items = forkCommandPaletteItems(context);
    const missed = items.flatMap((item) => {
      if (typeof item.title !== "string") return [];
      const found = filterCommandPaletteGroups({
        activeGroups: [{ value: "actions", label: "Actions", items }],
        query: item.title,
        isInSubmenu: false,
        projectSearchItems: [],
        threadSearchItems: [],
      }).flatMap((group) => group.items);
      return found.includes(item) ? [] : [item.title];
    });
    expect(items.length).toBeGreaterThan(0);
    expect(missed).toEqual([]);
  });

  it("use unique source ids", () => {
    const ids = FORK_COMMAND_PALETTE_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("give every item a unique action:loom: value", () => {
    const values = FORK_COMMAND_PALETTE_SOURCES.flatMap((source) =>
      source.items(context).map((item) => item.value),
    );
    expect(new Set(values).size).toBe(values.length);
    expect(values.filter((value) => !value.startsWith("action:loom:"))).toEqual([]);
  });
});
