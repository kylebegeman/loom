import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  clearLoomSignInDestination,
  loomSignInDestination,
  rememberLoomSignInDestination,
} from "./returnTo";

afterEach(() => vi.unstubAllGlobals());

it("retains the requested app page across the pairing redirect and clears it after sign-in", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      setItem: (key: string, value: string) => values.set(key, value),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    },
  });
  rememberLoomSignInDestination("https://loom.example/sites?range=30#checks");
  rememberLoomSignInDestination("https://loom.example/pair");
  expect(loomSignInDestination("https://loom.example/pair")).toBe("/sites?range=30#checks");
  expect(loomSignInDestination("https://loom.example/projects")).toBe("/projects");
  clearLoomSignInDestination();
  expect(loomSignInDestination("https://loom.example/pair")).toBe("/");
});

it("keeps sign-in available when tab storage is blocked or contains an external destination", () => {
  vi.stubGlobal("window", {
    sessionStorage: {
      setItem: () => {
        throw new Error("blocked");
      },
      getItem: () => "//attacker.invalid",
      removeItem: () => {
        throw new Error("blocked");
      },
    },
  });
  expect(() => rememberLoomSignInDestination("https://loom.example/sites")).not.toThrow();
  expect(loomSignInDestination("https://loom.example/pair")).toBe("/");
  expect(() => clearLoomSignInDestination()).not.toThrow();
});
