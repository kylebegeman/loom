import * as DateTime from "effect/DateTime";
import { it, expect } from "vite-plus/test";
import { packageFolderName, gerberArgs, bomArgs } from "./fabPackage.ts";
it("names revisions safely and orders copper while version gating zone checks", () => {
  const date = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-10T12:00:00Z"));
  expect(packageFolderName("main", "../A 2", "123456789", date)).toBe("main-_A_2-2026-10-10");
  expect(packageFolderName("main", "", "123456789", date)).toBe("main-h12345678-2026-10-10");
  const layers = ["B.Cu", "In2.Cu", "In1.Cu", "F.Cu", "Edge.Cuts", "F.Mask"];
  const args = gerberArgs("board", "out", layers, 10);
  expect(args[args.indexOf("--layers") + 1]).toBe("F.Cu,In1.Cu,In2.Cu,B.Cu,Edge.Cuts,F.Mask");
  expect(args).toContain("--check-zones");
  expect(gerberArgs("board", "out", layers, 9)).not.toContain("--check-zones");
  expect(bomArgs("board.sch", "out.csv", "LCSC Part #")).toContain(
    "Reference,Value,Footprint,${QUANTITY},${DNP},LCSC Part #",
  );
  expect(bomArgs("board", "out")).toContain('"');
  expect(bomArgs("board", "out")).toContain("");
});
