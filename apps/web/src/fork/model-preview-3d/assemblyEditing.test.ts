import { expect, it } from "vite-plus/test";
import type { AssemblyPart } from "@t3tools/contracts/fork";
import { assemblyNudge, pairIdentity, parseAssemblyTransform } from "./assemblyEditing";
const part: AssemblyPart = {
  id: "board",
  name: "Board",
  path: "board.glb",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  color: null,
  visible: true,
  parameters: {},
  parameterSet: null,
  explode: null,
};
it("transform drafts reject blanks, nonfinite values and out-of-contract coordinates", () => {
  expect(parseAssemblyTransform(["", "0", "0"])).toBeNull();
  expect(parseAssemblyTransform(["Infinity", "0", "0"])).toBeNull();
  expect(parseAssemblyTransform(["100001", "0", "0"])).toBeNull();
  expect(parseAssemblyTransform(["361", "0", "0"], true)).toBeNull();
  expect(parseAssemblyTransform(["-.25", "1.5", "0"])).toEqual([-0.25, 1.5, 0]);
});
it("placement nudges use exact millimetres and independent rotation steps", () => {
  expect(assemblyNudge(part, "x", 1, false, { shiftKey: false, altKey: false })).toEqual({
    op: "move-part",
    id: "board",
    by: [1, 0, 0],
  });
  expect(assemblyNudge(part, "y", -1, false, { shiftKey: true, altKey: false })).toEqual({
    op: "move-part",
    id: "board",
    by: [0, -10, 0],
  });
  expect(assemblyNudge(part, "z", 1, false, { shiftKey: false, altKey: true })).toEqual({
    op: "move-part",
    id: "board",
    by: [0, 0, 0.1],
  });
  expect(assemblyNudge(part, "x", -1, true, { shiftKey: true, altKey: true })).toEqual({
    op: "move-part",
    id: "board",
    rotateBy: [-15, 0, 0],
  });
});
it("clearance pairs have an order-independent identity", () =>
  expect(pairIdentity("board", "case")).toBe(pairIdentity("case", "board")));
