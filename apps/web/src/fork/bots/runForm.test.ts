import { describe, expect, it } from "vite-plus/test";
import type { BotParameter } from "@t3tools/contracts/fork";
import { runInputErrors, runValuesFrom, shortDescription } from "./runForm";
import { makeBotDefinition } from "./testFixtures";

const parameters: BotParameter[] = [
  { name: "pr", label: "Pull request", type: "string", required: true },
  { name: "notes", label: "Notes", type: "text", required: false },
  { name: "depth", label: "Depth", type: "number", required: false },
  { name: "mode", label: "Mode", type: "choice", required: true, choices: ["fast", "deep"] },
  { name: "strict", label: "Strict", type: "boolean", required: true },
];

describe("run input validation", () => {
  it("names each input that cannot be sent", () => {
    expect(
      runInputErrors(parameters, { pr: "  ", notes: "", depth: "abc", mode: "slow", strict: "" }),
    ).toEqual({
      pr: "Fill this in to run.",
      depth: "Enter a number, such as 3 or 2.5.",
      mode: "Choose one of the options.",
    });
  });

  it("accepts filled inputs, blank optional ones, and padded numbers", () => {
    expect(
      runInputErrors(parameters, { pr: "12", depth: " 2.5 ", mode: "deep", strict: "false" }),
    ).toEqual({});
    expect(runInputErrors(parameters, { pr: "12", mode: "fast" })).toEqual({});
  });

  it("lets a required input with a default stay blank, since the server fills the default", () => {
    const branch: BotParameter = {
      name: "branch",
      label: "Branch",
      type: "string",
      required: true,
    };
    expect(runInputErrors([{ ...branch, default: "main" }], { branch: "" })).toEqual({});
    expect(runInputErrors([branch], { branch: "" })).toEqual({ branch: "Fill this in to run." });
  });

  it("rejects a number the server would read as NaN or infinity", () => {
    expect(runInputErrors(parameters, { pr: "1", mode: "fast", depth: "1e999" })).toHaveProperty(
      "depth",
    );
  });
});

describe("running again", () => {
  it("prefills the earlier inputs and names the ones the bot no longer takes", () => {
    const bot = makeBotDefinition({
      parameters: [
        { name: "pr", label: "Pull request", type: "string", required: true },
        { name: "strict", label: "Strict", type: "boolean", required: false, default: "true" },
      ],
    });
    const { values, dropped } = runValuesFrom(bot, { pr: 42, branch: "main" });
    expect(values).toEqual({ pr: "42", strict: "true" });
    expect(dropped).toEqual(["branch"]);
    expect(runValuesFrom(bot, { strict: false }).values.strict).toBe("false");
  });
});

describe("short description", () => {
  it("keeps a short description whole, on one line", () => {
    expect(shortDescription("  Reviews\n the  change. ")).toBe("Reviews the change.");
  });

  it("cuts a long description at a word", () => {
    const long = `${"word ".repeat(60)}end`;
    const short = shortDescription(long);
    expect(short.endsWith("word…")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(161);
  });
});
