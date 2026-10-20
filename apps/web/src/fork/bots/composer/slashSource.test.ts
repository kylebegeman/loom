import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import type { BotDefinition } from "@t3tools/contracts/fork";
import { botSlashItems } from "./slashSource";

const bot = (id: string, overrides: Partial<BotDefinition> = {}): BotDefinition => ({
  id,
  name: id.toUpperCase(),
  description: "",
  instructions: "Do it.",
  parameters: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  version: 1,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: null,
  ...overrides,
});

describe("botSlashItems", () => {
  const here = ProjectId.make("project-a");
  const elsewhere = ProjectId.make("project-b");

  it("offers shared bots and bots scoped to the thread's project, never archived ones", () => {
    const items = botSlashItems(
      [
        bot("shared", { description: "Shared bot" }),
        bot("mine", { scopeProjectId: here }),
        bot("theirs", { scopeProjectId: elsewhere }),
        bot("old", { archivedAt: "2026-10-20T11:00:00.000Z" }),
      ],
      here,
    );
    expect(items.map((item) => item.value)).toEqual(["shared", "mine"]);
    expect(items[0]).toEqual({
      id: "bot:shared",
      type: "loom",
      source: "bots",
      label: "/bot:shared",
      description: "SHARED · Shared bot",
      value: "shared",
    });
    expect(items[1]?.description).toBe("MINE");
  });

  it("offers only shared bots in a thread without a project", () => {
    const items = botSlashItems([bot("shared"), bot("mine", { scopeProjectId: here })], null);
    expect(items.map((item) => item.value)).toEqual(["shared"]);
  });
});
