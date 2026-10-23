import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import { emptyBatchSourceDraft } from "@t3tools/client-runtime/fork";
import type { BotParameter } from "@t3tools/contracts/fork";
import { batchSource, parameterInputs } from "./runLogic";

const parameters: ReadonlyArray<BotParameter> = [
  { name: "file", label: "File", type: "string", required: true },
  { name: "limit", label: "Limit", type: "number", required: false },
  { name: "enabled", label: "Enabled", type: "boolean", required: false },
  {
    name: "mode",
    label: "Mode",
    type: "choice",
    choices: ["quick", "full"],
    default: "quick",
    required: false,
  },
];

describe("native bot run inputs", () => {
  it("validates required and numeric values before submitting a run", () => {
    expect(() => parameterInputs(parameters, { file: "  " })).toThrow("File is required.");
    expect(() => parameterInputs(parameters, { file: "src/app.ts", limit: "Infinity" })).toThrow(
      "Limit must be a finite number.",
    );
    expect(() => parameterInputs(parameters, { file: "src/app.ts", limit: "oops" })).toThrow(
      "Limit must be a finite number.",
    );
    expect(() => parameterInputs(parameters, { file: "src/app.ts", mode: "other" })).toThrow(
      "Choose a value for Mode.",
    );
  });

  it("preserves text, converts typed inputs, and leaves optional defaults to the server", () => {
    expect(
      parameterInputs(parameters, {
        file: " src/app.ts ",
        limit: "-2.5",
        enabled: "true",
        mode: "",
      }),
    ).toEqual({ file: " src/app.ts ", limit: -2.5, enabled: true });
    expect(parameterInputs(parameters, { file: "src/app.ts", limit: "  " })).toEqual({
      file: "src/app.ts",
      enabled: false,
    });
  });

  it("only attaches a valid selected checkout to file-based batch sources", () => {
    const checkout = ThreadId.make("checkout-a");
    expect(
      batchSource({ ...emptyBatchSourceDraft, type: "glob", pattern: " src/**/*.ts " }, checkout),
    ).toEqual({ type: "glob", pattern: "src/**/*.ts", checkoutThreadId: checkout });
    expect(batchSource({ ...emptyBatchSourceDraft, type: "conflicts" }, null)).toEqual({
      type: "conflicts",
    });
    expect(batchSource({ ...emptyBatchSourceDraft, lines: "one\ntwo" }, checkout)).toEqual({
      type: "lines",
      text: "one\ntwo",
    });
    expect(
      batchSource(
        { ...emptyBatchSourceDraft, type: "pullRequests", query: " author:me " },
        checkout,
      ),
    ).toEqual({ type: "pullRequests", query: "author:me" });
    expect(
      batchSource({ ...emptyBatchSourceDraft, type: "search", query: "  " }, checkout),
    ).toBeNull();
  });
});
