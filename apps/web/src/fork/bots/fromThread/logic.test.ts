import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { BOTS_FROM_THREAD_FEATURE, botRunThreadId } from "@t3tools/contracts/fork";
import { emptyBotDraft } from "@t3tools/client-runtime/fork";
import { canSaveAsBot, refineInputFromDraft } from "./logic";

const host = EnvironmentId.make("host");
const capable = { repositoryIdentity: true, loomFeatures: [BOTS_FROM_THREAD_FEATURE] };
const thread = { environmentId: host, threadId: ThreadId.make("thread-1") };

describe("saving a thread as a bot", () => {
  it("offers threads on the bots host that are not bot runs", () => {
    expect(canSaveAsBot(thread, capable, host)).toBe(true);
    expect(canSaveAsBot(thread, { ...capable, loomFeatures: [] }, host)).toBe(false);
    expect(canSaveAsBot(thread, undefined, host)).toBe(false);
    expect(canSaveAsBot(thread, capable, "other")).toBe(false);
    expect(canSaveAsBot(thread, capable, null)).toBe(false);
    expect(
      canSaveAsBot({ environmentId: host, threadId: botRunThreadId("run-1") }, capable, host),
    ).toBe(false);
  });

  it("refines only a draft that would save", () => {
    const draft = {
      ...emptyBotDraft({ instanceId: ProviderInstanceId.make("codex"), model: "test" }),
      id: "reviewer",
      name: "Reviewer",
      instructions: "Review the file.",
    };
    const refined = refineInputFromDraft(draft);
    expect(refined).toMatchObject({ ok: true, draft: { id: "reviewer", name: "Reviewer" } });
    expect(refined.ok && "expectedVersion" in refined.draft).toBe(false);
    expect(refineInputFromDraft({ ...draft, instructions: "" })).toMatchObject({ ok: false });
  });
});
