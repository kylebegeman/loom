import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ComputerRenameRequest } from "./computer-naming.ts";

it("bounds the rename wire payload and allows resetting to the host default", () => {
  const accepts = Schema.is(ComputerRenameRequest);
  for (const name of [null, "Orange Pi", "Kyle’s Mac", "x".repeat(100)])
    expect(accepts({ name })).toBe(true);
  for (const name of [
    "",
    " ",
    " leading",
    "trailing ",
    "x".repeat(101),
    "Pi\nRack",
    "Pi\u202eRack",
    42,
  ]) {
    expect(accepts({ name })).toBe(false);
  }
});
