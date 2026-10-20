import { describe, expect, it } from "vite-plus/test";

import type { UtilityResult } from "../types";
import { CHMOD_TOOLS, formatChmodOctal, formatChmodSymbolic, parseChmod } from "./chmod";
import { runInput } from "./testSupport";

const tool = CHMOD_TOOLS.chmod;
const run = (text: string): UtilityResult => {
  if (!tool.run) throw new Error("chmod has no run");
  return tool.run(runInput(tool, { text }));
};
const field = (result: UtilityResult, label: string) =>
  result.kind === "ok" ? result.fields.find((entry) => entry.label === label)?.value : undefined;
const errorOf = (text: string) => {
  const parsed = parseChmod(text);
  return "error" in parsed ? parsed.error : undefined;
};

describe("octal and symbolic forms", () => {
  it.each([
    ["755", "755", "rwxr-xr-x"],
    ["0644", "644", "rw-r--r--"],
    ["4755", "4755", "rwsr-xr-x"],
    ["1777", "1777", "rwxrwxrwt"],
    ["2750", "2750", "rwxr-s---"],
    ["0o750", "750", "rwxr-x---"],
    ["0O600", "600", "rw-------"],
    ["04755", "4755", "rwsr-xr-x"],
    ["0000", "000", "---------"],
    ["7777", "7777", "rwsrwsrwt"],
  ])("reads %s as %s, %s and back", (input, octal, symbolic) => {
    const parsed = parseChmod(input);
    if (!("mode" in parsed)) throw new Error(parsed.error);
    expect(formatChmodOctal(parsed.mode)).toBe(octal);
    expect(formatChmodSymbolic(parsed.mode)).toBe(symbolic);
    expect(parseChmod(symbolic)).toEqual({ mode: parsed.mode });
    expect(parseChmod(`-${symbolic}`)).toEqual({ mode: parsed.mode });
  });

  it("round-trips every 12-bit mode through both forms", () => {
    const mismatches = Array.from({ length: 0o10000 }, (_, mode) => mode).filter((mode) => {
      const octal = parseChmod(formatChmodOctal(mode));
      const symbolic = parseChmod(formatChmodSymbolic(mode));
      return !(
        "mode" in octal &&
        octal.mode === mode &&
        "mode" in symbolic &&
        symbolic.mode === mode
      );
    });
    expect(mismatches).toEqual([]);
  });

  it("reads symbolic and ls -l strings to octal", () => {
    expect(field(run("rwxr-xr-x"), "Octal")).toBe("755");
    expect(field(run("-rwsr-xr-x"), "Octal")).toBe("4755");
    expect(field(run("drwxrwxrwt"), "Octal")).toBe("1777");
    expect(field(run("lrwxrwxrwx"), "Octal")).toBe("777");
  });

  it("reads uppercase S and T as the special bit without execute", () => {
    expect(field(run("rwSr--r--"), "Octal")).toBe("4644");
    expect(field(run("rwxr-Sr--"), "Octal")).toBe("2744");
    expect(field(run("rwxr-xr-T"), "Octal")).toBe("1754");
    expect(formatChmodSymbolic(0o4644)).toBe("rwSr--r--");
    expect(formatChmodSymbolic(0o2704)).toBe("rwx--Sr--");
    expect(formatChmodSymbolic(0o1776)).toBe("rwxrwxrwT");
  });

  it("ignores surrounding whitespace and the marker macOS and GNU ls append", () => {
    expect(parseChmod("  755\n")).toEqual({ mode: 0o755 });
    expect(parseChmod("-rw-r--r--@")).toEqual({ mode: 0o644 });
    expect(parseChmod("drwxr-xr-x+")).toEqual({ mode: 0o755 });
    expect(parseChmod("-rw-r--r--.")).toEqual({ mode: 0o644 });
  });

  it("masks formatting input to 12 bits", () => {
    expect(formatChmodOctal(0o100644)).toBe("644");
    expect(formatChmodSymbolic(0o100644)).toBe("rw-r--r--");
  });
});

describe("chmod tool output", () => {
  it("describes a plain mode", () => {
    const result = run("755");
    expect(result).toEqual({
      kind: "ok",
      fields: [
        { label: "Octal", value: "755", monospace: true },
        { label: "Symbolic", value: "rwxr-xr-x", monospace: true },
        { label: "ls -l form", value: "-rwxr-xr-x", monospace: true },
        { label: "Owner", value: "Owner can read, write and execute." },
        { label: "Group", value: "Group can read and execute." },
        { label: "Others", value: "Others can read and execute." },
        { label: "Special bits", value: "None" },
        { label: "Command", value: "chmod 755 <file>", monospace: true },
      ],
    });
  });

  it.each([
    ["640", "Owner can read and write.", "Group can read.", "Others have no access."],
    ["070", "Owner has no access.", "Group can read, write and execute.", "Others have no access."],
    ["123", "Owner can execute.", "Group can write.", "Others can write and execute."],
    ["456", "Owner can read.", "Group can read and execute.", "Others can read and write."],
  ])("writes a sentence per class for %s", (mode, owner, group, others) => {
    const result = run(mode);
    expect(field(result, "Owner")).toBe(owner);
    expect(field(result, "Group")).toBe(group);
    expect(field(result, "Others")).toBe(others);
  });

  it.each([
    ["4755", "Setuid", "chmod 4755 <file>"],
    ["2750", "Setgid", "chmod 2750 <file>"],
    ["1777", "Sticky", "chmod 1777 <file>"],
    ["6755", "Setuid and setgid", "chmod 6755 <file>"],
    ["7777", "Setuid, setgid and sticky", "chmod 7777 <file>"],
    ["0644", "None", "chmod 644 <file>"],
  ])("names the special bits of %s and uses them in the command", (mode, special, command) => {
    const result = run(mode);
    expect(field(result, "Special bits")).toBe(special);
    expect(field(result, "Command")).toBe(command);
  });

  it("always writes the ls -l form as a regular file", () => {
    expect(field(run("drwxr-x---"), "ls -l form")).toBe("-rwxr-x---");
    expect(field(run("----------"), "Owner")).toBe("Owner has no access.");
  });

  it("produces an ok result from its example", () => {
    expect(tool.example).toBeDefined();
    expect(tool.run?.(runInput(tool, { text: tool.example?.text ?? "" })).kind).toBe("ok");
  });
});

describe("invalid input", () => {
  it.each([
    ["8", 'Unexpected "8" at position 1; expected an octal digit from 0 to 7.'],
    ["759", 'Unexpected "9" at position 3; expected an octal digit from 0 to 7.'],
    ["0o7a5", 'Unexpected "a" at position 4; expected an octal digit from 0 to 7.'],
    ["  0x1ed", 'Unexpected "x" at position 4; expected an octal digit from 0 to 7.'],
    ["12345", "An octal mode has 3 or 4 digits; this has 5."],
    ["75", "An octal mode has 3 or 4 digits; this has 2."],
    ["0o", "An octal mode has 3 or 4 digits; this has 0."],
    ["rwxrwxrw", "A symbolic mode has 9 characters, or 10 in ls -l form; this has 8."],
    ["-rwxr-xr-xx", "A symbolic mode has 9 characters, or 10 in ls -l form; this has 11."],
    ["rwxqwxrwx", 'Unexpected "q" at position 4; expected r or -.'],
    ["rwxr-ar-x", 'Unexpected "a" at position 6; expected x, s, S or -.'],
    ["rwxr-xr-s", 'Unexpected "s" at position 9; expected x, t, T or -.'],
    ["RWXR-XR-X", 'Unexpected "R" at position 1; expected r or -.'],
    ["-rwxr-xr-w", 'Unexpected "w" at position 10; expected x, t, T or -.'],
    ["xrwxr-xr-x", 'Unexpected "x" at position 1; expected a file type (-, d, l, c, b, p or s).'],
    ["rw\u{1F600}r--r--", 'Unexpected "\u{1F600}" at position 3; expected x, s, S or -.'],
    ["", "Enter a mode such as 755 or rwxr-xr-x."],
    ["   ", "Enter a mode such as 755 or rwxr-xr-x."],
  ])("rejects %j", (input, message) => {
    expect(errorOf(input)).toBe(message);
    expect(run(input)).toEqual({ kind: "error", message });
  });

  it.each([
    ["755​", "Unexpected U+200B at position 4; expected an octal digit from 0 to 7."],
    ["755\r\n644", "Unexpected U+000D at position 4; expected an octal digit from 0 to 7."],
    ["7 55", "Unexpected U+00A0 at position 2; expected an octal digit from 0 to 7."],
    ["rw\u0000r--r--", "Unexpected U+0000 at position 3; expected x, s, S or -."],
    ["rw\uD800r--r--", "Unexpected U+D800 at position 3; expected x, s, S or -."],
    ["ŕ-r--r--", "Unexpected U+0301 at position 2; expected w or -."],
  ])("names the invisible character in %j by code point", (input, message) => {
    expect(errorOf(input)).toBe(message);
  });

  it.each([
    ["٧٥٥", "٧"],
    ["７５５", "７"],
  ])("reads non-ASCII digits %j as a bad octal digit", (input, digit) => {
    expect(errorOf(input)).toBe(
      `Unexpected "${digit}" at position 1; expected an octal digit from 0 to 7.`,
    );
  });

  it.each(["u+x", "go-w", "a=r", "u=rwx,go=rx", "+x", "-755", "-022"])(
    "explains that the chmod expression %s is not a full mode",
    (input) => {
      expect(errorOf(input)).toBe(
        "Expressions such as u+x change an existing mode; enter a full mode such as 755 or rwxr-xr-x.",
      );
    },
  );

  it("never throws on odd strings", () => {
    const inputs = ["\uD800", "0".repeat(10_000), "-".repeat(12), "\u0000\u0000\u0000", "٧٥٥"];
    expect(inputs.map((text) => run(text).kind)).toEqual(inputs.map(() => "error"));
  });
});
