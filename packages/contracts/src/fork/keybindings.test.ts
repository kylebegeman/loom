import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { KeybindingCommand, STATIC_KEYBINDING_COMMANDS } from "../keybindings.ts";
import { FORK_KEYBINDING_COMMANDS } from "./keybindings.ts";

const forkCommands: ReadonlyArray<string> = FORK_KEYBINDING_COMMANDS;

describe("fork keybinding commands", () => {
  it("start with loom. and are unique", () => {
    expect(forkCommands.filter((command) => !command.startsWith("loom."))).toEqual([]);
    expect(new Set(forkCommands).size).toBe(forkCommands.length);
  });

  it("decode as keybinding commands", () => {
    const decode = Schema.decodeUnknownSync(KeybindingCommand);
    for (const command of forkCommands) expect(decode(command)).toBe(command);
  });

  it("never reuse an upstream command", () => {
    // An upstream command with a fork command's name would be listed twice.
    const loomCommands = STATIC_KEYBINDING_COMMANDS.filter((command: string) =>
      command.startsWith("loom."),
    );
    expect(loomCommands.toSorted()).toEqual(forkCommands.toSorted());
  });
});
