import { describe, expect, it } from "vite-plus/test";

import { searchUtilityTools, UTILITY_QUICK_ACTIONS, UTILITY_TOOL_META } from "./registry-meta";
import {
  findUtilityTool,
  runUtilityTool,
  UTILITY_IMPLEMENTATIONS,
  UTILITY_TOOLS,
} from "./registry";
import { MAX_INPUT_BYTES } from "./tools/limits";
import { runInput } from "./tools/testSupport";
import { defaultOptions, type UtilityTool } from "./types";

const withExample = UTILITY_TOOLS.filter(
  (tool): tool is UtilityTool & { example: NonNullable<UtilityTool["example"]> } =>
    tool.example !== undefined,
);

function runExample(tool: (typeof withExample)[number]) {
  return runUtilityTool(
    tool,
    tool.run ? "run" : "generate",
    runInput(tool, {
      text: tool.example.text,
      second: tool.example.second ?? "",
      options: tool.example.options ?? {},
    }),
  );
}

describe("utility registry", () => {
  it("has all 29 tools with unique kebab-case ids", () => {
    expect(UTILITY_TOOLS).toHaveLength(29);
    const ids = UTILITY_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("pairs every metadata entry with an implementation and the reverse", () => {
    expect(UTILITY_TOOL_META.map((meta) => meta.id).toSorted()).toEqual(
      Object.keys(UTILITY_IMPLEMENTATIONS).toSorted(),
    );
  });

  it("gives every tool something to do", () => {
    for (const tool of UTILITY_TOOLS)
      expect(tool.run !== undefined || tool.generate !== undefined, tool.id).toBe(true);
  });

  it("names only real tools as quick actions", () => {
    for (const action of UTILITY_QUICK_ACTIONS) expect(findUtilityTool(action.id)).not.toBeNull();
  });

  it.each(withExample.map((tool) => [tool.id, tool] as const))(
    "runs the %s example to an ok result",
    (_id, tool) => {
      expect(runExample(tool)).toMatchObject({ kind: "ok" });
    },
  );

  it.each(
    withExample
      .filter((tool) => tool.swap && tool.input === "text")
      .map((tool) => [tool.id, tool] as const),
  )("round-trips the %s example through Swap", (_id, tool) => {
    const first = runExample(tool);
    if (first?.kind !== "ok") throw new Error(`${tool.id} example failed`);
    const output = first.fields[0]?.value ?? "";
    const options = { ...defaultOptions(tool.options), ...tool.example.options };
    const back = runUtilityTool(
      tool,
      "run",
      runInput(tool, { text: output, options: tool.swap?.(options) ?? options }),
    );
    expect(back?.kind === "ok" ? back.fields[0]?.value : back).toBe(tool.example.text);
  });

  it("refuses input over the size limit before running the tool", () => {
    const base64 = findUtilityTool("base64");
    if (!base64) throw new Error("base64 is missing");
    expect(
      runUtilityTool(base64, "run", runInput(base64, { text: "a".repeat(MAX_INPUT_BYTES + 1) })),
    ).toEqual({ kind: "error", message: "Input is larger than 1 MiB." });
  });

  it("shows a thrown error as an error result", () => {
    const tool: UtilityTool = {
      id: "boom",
      label: "Boom",
      category: "text",
      description: "",
      keywords: [],
      input: "text",
      options: [],
      run: () => {
        throw new Error("broken");
      },
    };
    expect(runUtilityTool(tool, "run", runInput(tool, { text: "x" }))).toEqual({
      kind: "error",
      message: "broken",
    });
    expect(runUtilityTool(tool, "generate", runInput(tool))).toBeNull();
  });
});

describe("searchUtilityTools", () => {
  it("lists everything in list order for an empty query", () => {
    expect(searchUtilityTools("  ")).toBe(UTILITY_TOOL_META);
  });

  it("ranks prefix matches before substring matches", () => {
    let mixed = 0;
    for (const query of ["en", "code", "url", "time", "hex"]) {
      const prefix = searchUtilityTools(query).map((tool) =>
        [tool.label, tool.id, ...tool.keywords].some((term) =>
          term.toLowerCase().startsWith(query),
        ),
      );
      if (prefix.includes(true) && prefix.includes(false)) mixed++;
      expect(prefix.lastIndexOf(true), query).toBeLessThan(
        prefix.includes(false) ? prefix.indexOf(false) : Infinity,
      );
    }
    // At least one query has both kinds, so the ordering was really exercised.
    expect(mixed).toBeGreaterThan(0);
  });

  it("orders equal matches by recent use", () => {
    const plain = searchUtilityTools("e").map((tool) => tool.id);
    const last = plain.at(-1) ?? "";
    expect(
      searchUtilityTools("e", [last])
        .map((tool) => tool.id)
        .indexOf(last),
    ).toBeLessThan(plain.indexOf(last));
  });

  it("finds tools by keyword", () => {
    for (const [query, id] of [
      ["jwt", "jwt"],
      ["epoch", "timestamp"],
      ["subnet", "cidr"],
      ["regex", "regex"],
    ] as const)
      expect(searchUtilityTools(query).map((tool) => tool.id)).toContain(id);
  });
});
