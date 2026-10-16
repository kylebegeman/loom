import { ProviderInstanceId, type ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { profileDifferences, profileFill } from "./LibraryProfileSettings.ts";

const script: ProjectScript = {
  id: "dev",
  name: "Dev",
  command: "vp run dev",
  icon: "play",
  runOnWorktreeCreate: false,
};
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

describe("profile settings", () => {
  it("never clears local settings with an empty or absent setup value", () => {
    const local = { scripts: [script], defaultModelSelection: model };
    expect(profileFill(local, { scripts: [] })).toEqual({});
    expect(profileDifferences(local, { scripts: [] })).toEqual([]);
    expect(profileDifferences(local, {})).toEqual([]);
  });

  it("fills only settings the local project lacks", () => {
    expect(
      profileFill(
        { scripts: [], defaultModelSelection: model },
        { scripts: [script], defaultModelSelection: { ...model, model: "gpt-6" } },
      ),
    ).toEqual({ scripts: [script] });
  });

  it("treats the same settings written in another key order as equal", () => {
    const reordered = Object.fromEntries(Object.entries(script).toReversed()) as ProjectScript;
    expect(
      profileDifferences(
        {
          scripts: [reordered],
          defaultModelSelection: { model: "gpt-5", instanceId: model.instanceId },
        },
        { scripts: [script], defaultModelSelection: model },
      ),
    ).toEqual([]);
  });
});
