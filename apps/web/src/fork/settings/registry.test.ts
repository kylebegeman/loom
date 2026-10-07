import { expect, it } from "vite-plus/test";
import { FORK_SETTINGS_SECTIONS } from "./registry";
it("registers unique settings section ids", () => {
  const ids = FORK_SETTINGS_SECTIONS.map((section) => section.id);
  expect(new Set(ids).size).toBe(ids.length);
});
