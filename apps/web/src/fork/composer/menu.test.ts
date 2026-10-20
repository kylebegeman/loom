import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ComposerTrigger } from "~/composer-logic";
import { useBotRunDrawerStore } from "../bots/composer/drawerStore";
import { searchForkSlashItems, selectForkComposerItem, type ForkComposerCommandItem } from "./menu";

const item = (value: string, description: string): ForkComposerCommandItem => ({
  id: `bot:${value}`,
  type: "loom",
  source: "bots",
  label: `/bot:${value}`,
  description,
  value,
});

const reviewer = item("reviewer", "Reviewer · Reviews a change");
const verifier = item("verifier", "Verifier · Checks a claim");
const resolver = item("merge-conflict-resolver", "Resolves a conflicted file");

describe("searchForkSlashItems", () => {
  it("lists every item for an empty query", () => {
    expect(searchForkSlashItems([reviewer, verifier], "")).toEqual([reviewer, verifier]);
  });

  it("ranks the bot prefix, the id after it, and the description", () => {
    expect(searchForkSlashItems([resolver, reviewer, verifier], "bot:ver")[0]).toBe(verifier);
    expect(searchForkSlashItems([resolver, reviewer, verifier], "rev")[0]).toBe(reviewer);
    expect(searchForkSlashItems([reviewer, verifier, resolver], "conflict")[0]).toBe(resolver);
    expect(searchForkSlashItems([reviewer, verifier, resolver], "claim")).toEqual([verifier]);
    expect(searchForkSlashItems([reviewer, verifier], "zzz")).toEqual([]);
  });
});

describe("selectForkComposerItem", () => {
  const trigger: ComposerTrigger = {
    kind: "slash-command",
    query: "bot:rev",
    rangeStart: 4,
    rangeEnd: 12,
  };
  const context = {
    environmentId: EnvironmentId.make("env-1"),
    threadRef: { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("t-1") },
    projectId: null,
  };

  it("removes the slash token, then opens the bot's run form for the thread", () => {
    useBotRunDrawerStore.getState().close();
    const replaced: Array<[number, number, string, string | undefined]> = [];
    const chosen = selectForkComposerItem(reviewer, {
      snapshot: { value: "fix /bot:rev now" },
      trigger,
      replace: (start, end, text, options) => {
        replaced.push([start, end, text, options?.expectedText]);
        return true;
      },
      context,
    });
    expect(chosen).toBe(true);
    expect(replaced).toEqual([[4, 12, "", "/bot:rev"]]);
    expect(useBotRunDrawerStore.getState().open).toEqual({
      threadKey: "env-1:t-1",
      botId: "reviewer",
    });
  });

  it("does nothing when the prompt changed under the menu", () => {
    useBotRunDrawerStore.getState().close();
    const chosen = selectForkComposerItem(reviewer, {
      snapshot: { value: "fix /bot:rev now" },
      trigger,
      replace: () => false,
      context,
    });
    expect(chosen).toBe(false);
    expect(useBotRunDrawerStore.getState().open).toBeNull();
  });
});
