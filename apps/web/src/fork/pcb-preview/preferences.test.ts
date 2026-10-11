import { expect, it } from "vite-plus/test";
import { decodePreferences } from "./preferences.ts";

it("keeps trust from preferences saved before later fields existed", () => {
  const saved = JSON.stringify({ trusted: ['["env","project"]'] });
  expect(decodePreferences(saved)).toEqual({
    selections: {},
    trusted: ['["env","project"]'],
    electronicsUrl: "",
  });
});
