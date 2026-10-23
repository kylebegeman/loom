import { describe, expect, it } from "vite-plus/test";
import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { BOTS_FEATURE, BOTS_FROM_THREAD_FEATURE } from "@t3tools/contracts/fork";
import { buildThreadBotsMenuItems } from "./threadMenu";

const capabilities = (features: string[]): ExecutionEnvironmentCapabilities => ({
  repositoryIdentity: false,
  loomFeatures: features,
});
describe("native thread Bots actions", () => {
  it("hides actions on old hosts and bot-run threads", () => {
    expect(
      buildThreadBotsMenuItems({ capabilities: undefined, threadId: "thread", canOperate: true }),
    ).toEqual([]);
    expect(
      buildThreadBotsMenuItems({
        capabilities: capabilities([BOTS_FEATURE, BOTS_FROM_THREAD_FEATURE]),
        threadId: "bot-run-result",
        canOperate: true,
      }),
    ).toEqual([]);
  });
  it("offers source drafting only when supported by the destination computer", () => {
    expect(
      buildThreadBotsMenuItems({
        capabilities: capabilities([BOTS_FEATURE]),
        threadId: "thread",
        canOperate: true,
      }).map((item) => item.id),
    ).toEqual(["bots-run"]);
    expect(
      buildThreadBotsMenuItems({
        capabilities: capabilities([BOTS_FEATURE, BOTS_FROM_THREAD_FEATURE]),
        threadId: "thread",
        canOperate: true,
      }).map((item) => item.id),
    ).toEqual(["bots-run", "bots-create"]);
  });
  it("keeps read-only actions unavailable", () => {
    expect(
      buildThreadBotsMenuItems({
        capabilities: capabilities([BOTS_FEATURE, BOTS_FROM_THREAD_FEATURE]),
        threadId: "thread",
        canOperate: false,
      }).every((item) => item.attributes?.disabled),
    ).toBe(true);
  });
});
