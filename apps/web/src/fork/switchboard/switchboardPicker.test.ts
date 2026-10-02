import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderState,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "~/providerInstances";
import { collapseForSwitchboard } from "./switchboardPicker";

const entry = (
  id: string,
  driver: string,
  options: { enabled?: boolean; status?: ServerProviderState } = {},
): ProviderInstanceEntry => ({
  instanceId: ProviderInstanceId.make(id),
  driverKind: ProviderDriverKind.make(driver),
  displayName: id,
  accentColor: "#336699",
  enabled: options.enabled ?? true,
  installed: true,
  status: options.status ?? "ready",
  isDefault: id === driver,
  isAvailable: true,
  snapshot: {} as ServerProvider,
  models: [],
});

const entries = [
  entry("codex", "codex", { enabled: false }),
  entry("claudeAgent", "claudeAgent", { enabled: false }),
  entry("codex_1", "codex", { status: "error" }),
  entry("codex_2", "codex"),
  entry("claude_1", "claudeAgent"),
  entry("claude_2", "claudeAgent"),
  entry("grok", "grok"),
];

const ids = (list: ReadonlyArray<ProviderInstanceEntry>) => list.map((e) => e.instanceId);

describe("collapseForSwitchboard", () => {
  it("keeps one plain Claude and one plain Codex in their places, and every other provider", () => {
    const collapsed = collapseForSwitchboard(entries, undefined);
    expect(ids(collapsed)).toEqual(["codex_2", "claude_1", "grok"]);
    expect(collapsed.map((e) => [e.displayName, e.accentColor])).toEqual([
      ["Codex", undefined],
      ["Claude", undefined],
      ["grok", "#336699"],
    ]);
  });

  it("keeps the selected account so a thread's routing key stays valid", () => {
    expect(ids(collapseForSwitchboard(entries, ProviderInstanceId.make("claude_2")))).toEqual([
      "codex_2",
      "claude_2",
      "grok",
    ]);
  });

  it("falls back to an enabled account when none is ready", () => {
    const notReady = entries.map((e) => ({ ...e, status: "warning" as const }));
    expect(ids(collapseForSwitchboard(notReady, undefined))).toEqual([
      "codex_1",
      "claude_1",
      "grok",
    ]);
  });
});
