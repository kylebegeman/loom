import { describe, expect, it } from "vite-plus/test";
import type { BotParameter } from "@t3tools/contracts/fork";
import { capReply } from "./BotsService.ts";
import { checkParameters, renderInstructions, validateInputs } from "./render.ts";

const parameters: ReadonlyArray<BotParameter> = [
  { name: "file", label: "File", type: "string", required: true },
  { name: "depth", label: "Depth", type: "number", required: false, default: "2" },
  { name: "strict", label: "Strict", type: "boolean", required: false },
  { name: "tone", label: "Tone", type: "choice", required: false, choices: ["terse", "full"] },
];

describe("validateInputs", () => {
  it("applies defaults, coerces agent-style strings and skips empty optionals", () => {
    expect(validateInputs({ parameters }, { file: "a.ts", strict: "true", tone: "" })).toEqual({
      ok: true,
      values: { file: "a.ts", depth: 2, strict: true },
    });
  });

  it("refuses missing required inputs, unknown names, bad numbers and choices", () => {
    expect(validateInputs({ parameters }, { file: "  " })).toMatchObject({
      ok: false,
      message: "File is required.",
    });
    expect(validateInputs({ parameters }, { file: "a", fiel: "b" })).toMatchObject({
      ok: false,
      message: "This bot has no input named fiel.",
    });
    expect(validateInputs({ parameters }, { file: "a", depth: "deep" })).toMatchObject({
      ok: false,
    });
    expect(validateInputs({ parameters }, { file: "a", tone: "loud" })).toMatchObject({
      ok: false,
      message: "Tone must be one of: terse, full.",
    });
  });
});

describe("checkParameters", () => {
  it("catches duplicate names and defaults that fail their own type", () => {
    expect(checkParameters({ parameters })).toBeNull();
    expect(checkParameters({ parameters: [parameters[0]!, parameters[0]!] })).toBe(
      "Two parameters are named file.",
    );
    expect(
      checkParameters({
        parameters: [{ name: "n", label: "N", type: "number", required: false, default: "x" }],
      }),
    ).toBe("Default value: N must be a number.");
  });
});

describe("renderInstructions", () => {
  it("fills declared placeholders and leaves unknown ones visible", () => {
    expect(
      renderInstructions(
        { instructions: "Review {{ file }} at depth {{depth}} {{strict}} {{tpyo}}", parameters },
        { file: "a.ts", depth: 2 },
      ),
    ).toBe("Review a.ts at depth 2  {{tpyo}}");
  });
});

describe("capReply", () => {
  it("cuts at the byte limit without splitting a character", () => {
    const capped = capReply("é".repeat(10_000));
    expect(capped.truncated).toBe(true);
    expect(new TextEncoder().encode(capped.text).length).toBeLessThanOrEqual(16 * 1024);
    expect(capped.text).not.toContain("�");
    expect(capReply("short")).toEqual({ text: "short", truncated: false });
  });
});
