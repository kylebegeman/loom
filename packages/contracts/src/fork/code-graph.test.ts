import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CODE_GRAPH_WS_METHODS,
  CodeGraphSettingsPatch,
  TESTED_GRAPHIFY_VERSION,
  graphifyInstallCommands,
  graphifyUvxCommand,
} from "./code-graph.ts";

describe("code-graph contracts", () => {
  it("prefixes every tag with loom.code-graph.", () => {
    const tags = Object.values(CODE_GRAPH_WS_METHODS);
    expect(tags.filter((tag) => !tag.startsWith("loom.code-graph."))).toEqual([]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("pins every suggested install to the tested Graphify release", () => {
    for (const command of [...graphifyInstallCommands(), graphifyUvxCommand().join(" ")]) {
      expect(command).toContain(`graphifyy==${TESTED_GRAPHIFY_VERSION}`);
    }
  });

  it("rejects an empty Graphify command", () => {
    const decode = Schema.decodeUnknownOption(CodeGraphSettingsPatch);
    expect(decode({ command: [] })._tag).toBe("None");
    expect(decode({ command: [""] })._tag).toBe("None");
    expect(decode({ command: graphifyUvxCommand() })._tag).toBe("Some");
  });
});
