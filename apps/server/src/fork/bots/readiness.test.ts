import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { providerProblems, toolProblems } from "./readiness.ts";
import { model } from "./testing/BotsHarness.ts";

const now = Date.parse("2026-10-22T17:00:00Z");
const provider = (fields: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: model.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-22T17:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...fields,
});

describe("bot provider readiness", () => {
  it("uses current authentication and provider health, including named instances", () => {
    expect(providerProblems(provider(), now)).toEqual([]);
    expect(providerProblems(provider({ auth: { status: "unauthenticated" } }), now)).toEqual([
      { availability: "blocked", message: "Its provider is not signed in on this computer." },
    ]);
    expect(providerProblems(provider({ status: "error" }), now)[0]?.availability).toBe("blocked");
    expect(providerProblems(provider({ enabled: false }), now)[0]?.availability).toBe("blocked");
    expect(providerProblems(provider({ installed: false }), now)[0]?.availability).toBe("blocked");
  });

  it("does not claim current authentication from missing, unknown, or stale snapshots", () => {
    expect(providerProblems(undefined, now)[0]?.availability).toBe("unknown");
    expect(providerProblems(provider({ auth: { status: "unknown" } }), now)[0]?.availability).toBe(
      "unknown",
    );
    expect(providerProblems(provider(), now + 180_000)[0]?.availability).toBe("unknown");
    expect(providerProblems(provider({ checkedAt: "invalid" }), now)[0]?.availability).toBe(
      "unknown",
    );
    expect(providerProblems(provider(), now - 180_000)[0]?.availability).toBe("unknown");
    expect(
      providerProblems(
        provider({
          auth: { status: "unknown" },
          setup: { canAuthenticate: false, canInstall: false },
        }),
        now,
      ),
    ).toEqual([]);
  });
});

it("blocks missing and outdated required tools and preserves unknown probe results", () => {
  expect(
    toolProblems([
      { id: "git", label: "Git", status: "ok", version: "2.50" },
      { id: "node", label: "Node.js", status: "outdated", version: "20", minimumVersion: "22" },
      { id: "pnpm", label: "pnpm", status: "missing" },
      { id: "swift", label: "Swift", status: "unknown" },
    ]),
  ).toEqual([
    { availability: "blocked", message: "The required Node.js tool needs version 22." },
    { availability: "blocked", message: "The required pnpm tool is missing on this computer." },
    { availability: "unknown", message: "The required Swift tool could not be checked." },
  ]);
});
