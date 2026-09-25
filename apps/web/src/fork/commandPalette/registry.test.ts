import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { FORK_COMMAND_PALETTE_SOURCES } from "./registry";

// Every source with its feature on and a thread open, so each lists all of its items.
const context = {
  activeThreadRef: scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1")),
  loomFeatures: ["core", ...FORK_COMMAND_PALETTE_SOURCES.map((source) => source.id)],
};

describe("fork command palette sources", () => {
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
