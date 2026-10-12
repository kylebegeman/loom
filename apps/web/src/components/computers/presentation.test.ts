import { expect, it } from "vite-plus/test";
import { readyAgentCount } from "./presentation";

it("does not call disabled, missing or unroutable providers ready", () => {
  const ready = {
    enabled: true,
    installed: true,
    status: "ready" as const,
    models: [{} as import("@t3tools/contracts").ServerProviderModel],
  };
  expect(
    readyAgentCount([
      ready,
      { ...ready, enabled: false },
      { ...ready, installed: false },
      { ...ready, availability: "unavailable" as const },
      { ...ready, status: "error" as const },
      { ...ready, models: [] },
    ]),
  ).toBe(1);
});
