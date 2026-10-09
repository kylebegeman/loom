import { describe, expect, it } from "vite-plus/test";

import { FORK_DIFF_HEADER_ACTIONS } from "./registry";

describe("fork diff header actions", () => {
  it("have unique ids", () => {
    const ids = FORK_DIFF_HEADER_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
