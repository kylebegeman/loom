import { expect, it } from "vite-plus/test";
import { FORK_SETTINGS_SECTIONS } from "./registry";

it("registers unique settings section ids", () => {
  const ids = FORK_SETTINGS_SECTIONS.map((section) => section.id);
  expect(new Set(ids).size).toBe(ids.length);
});

it("gives every topic a settings home and a title search results can tell apart", () => {
  expect(FORK_SETTINGS_SECTIONS.every((section) => section.home.startsWith("/settings/"))).toBe(
    true,
  );
  const titles = FORK_SETTINGS_SECTIONS.map((section) => section.title.toLowerCase());
  expect(new Set(titles).size).toBe(titles.length);
});

it("folds advanced topics only where the Vault page shows its disclosure", () => {
  const advanced = FORK_SETTINGS_SECTIONS.filter((section) => section.advanced);
  expect(advanced.map((section) => section.id)).toEqual([
    "vault-brokers",
    "vault-health",
    "vault-migration",
    "vault-migration-inventory",
  ]);
  expect(advanced.every((section) => section.home === "/settings/vault")).toBe(true);
});
