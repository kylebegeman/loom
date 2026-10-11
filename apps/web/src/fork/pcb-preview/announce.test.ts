import { expect, it } from "vite-plus/test";
import type { PcbComponent } from "@t3tools/contracts/fork";
import { announcement, describeSelection, type PcbAnnounceInput } from "./announce";
const initial: PcbAnnounceInput = {
  place: "Board, Front copper",
  selection: null,
  tool: null,
  checking: null,
  checks: {},
  building: false,
  shown: null,
  three: null,
  notice: null,
  step: null,
};
const component: PcbComponent = {
  id: "U3",
  reference: "U3",
  value: "ATmega328P",
  footprint: "",
  pins: [
    { number: "5", name: "PB2", net: "SCK" },
    { number: "6", name: "", net: "" },
  ],
};
it("describes components, pins, nets, empty fields and unknown references", () => {
  expect(describeSelection([component], "U3", null, null)).toBe("U3, ATmega328P");
  expect(describeSelection([], "U1", null, null)).toBe("U1");
  expect(describeSelection([component], "U3", "5", "SCK")).toBe("U3 pin 5, PB2, net SCK");
  expect(describeSelection([component], "U3", "6", null)).toBe("U3 pin 6");
  expect(describeSelection([component], "U3", "5", null)).toBe("U3 pin 5, PB2, net SCK");
  expect(describeSelection([], null, null, "GND")).toBe("Net GND");
  expect(describeSelection([], null, null, null)).toBeNull();
});
it("is silent on mount and unchanged state", () => {
  expect(announcement(null, initial)).toBeNull();
  expect(announcement(initial, { ...initial })).toBeNull();
});
it("prioritizes explicit finding steps over selection and surface changes, including repeated steps", () => {
  const next = {
    ...initial,
    selection: "U3",
    place: "Schematic",
    step: { id: 1, text: "Finding 3 of 12. Error, DRC: Clearance violation" },
  };
  expect(announcement(initial, next)).toBe(next.step.text);
  expect(announcement(next, { ...next, step: { ...next.step, id: 2 } })).toBe(next.step.text);
  expect(announcement(initial, { ...next, step: null })).toBe("U3");
});
it("describes place and tool changes and clearing", () => {
  expect(announcement(initial, { ...initial, place: "Schematic, sheet 2 of 3, Power" })).toBe(
    "Schematic, sheet 2 of 3, Power",
  );
  expect(announcement({ ...initial, selection: "U3" }, initial)).toBe("Selection cleared");
  expect(
    announcement(initial, { ...initial, tool: "Distance, point 1 of 2. Click two points" }),
  ).toBe("Distance, point 1 of 2. Click two points");
  expect(announcement({ ...initial, tool: "Distance" }, initial)).toBe("Select");
});
it("announces only watched check runs and reports counts without zeros", () => {
  const result = {
    ranAt: "2026-10-11T00:00:00Z",
    outcome: "violations" as const,
    counts: { errors: 3, warnings: 5, excluded: 0 },
  };
  const running = { ...initial, checking: "drc" as const };
  expect(announcement(initial, running)).toBe("Running DRC");
  expect(announcement(running, { ...initial, checks: { drc: result } })).toBe(
    "DRC: 3 errors, 5 warnings",
  );
  expect(announcement(initial, { ...initial, checks: { drc: result } })).toBeNull();
  expect(
    announcement({ ...running, checks: { drc: result } }, { ...initial, checks: { drc: result } }),
  ).toBeNull();
  expect(
    announcement(running, {
      ...initial,
      checks: { drc: { ...result, counts: { errors: 0, warnings: 1, excluded: 0 } } },
    }),
  ).toBe("DRC: 1 warning");
  expect(
    announcement(running, { ...initial, checks: { drc: { ...result, outcome: "clean" } } }),
  ).toBe("DRC clean");
});
it.each(["failed", "timed-out"] as const)("reports a watched %s check", (outcome) => {
  expect(
    announcement(
      { ...initial, checking: "erc" },
      {
        ...initial,
        checks: { erc: { ranAt: "now", outcome, counts: { errors: 0, warnings: 0, excluded: 0 } } },
      },
    ),
  ).toBe("ERC could not run");
});
it("announces first builds and readiness, then only updated for live rebuilds", () => {
  const shown = { surface: "pcb", sheet: "board", sourceHash: "one" };
  expect(announcement(initial, { ...initial, building: true })).toBe("Building board");
  expect(announcement({ ...initial, building: true }, { ...initial, shown })).toBe("Board ready");
  expect(announcement({ ...initial, shown }, { ...initial, shown, building: true })).toBeNull();
  expect(
    announcement(
      { ...initial, shown, building: true },
      { ...initial, shown: { ...shown, sourceHash: "two" } },
    ),
  ).toBe("Board updated");
  const schematic = { ...initial, place: "Schematic" };
  expect(announcement(schematic, { ...schematic, building: true })).toBe("Building schematic");
});
it("announces 3D loading, readiness, history and fresh notices without repeating errors", () => {
  expect(announcement(initial, { ...initial, three: "loading" })).toBe("Loading 3D board");
  expect(announcement({ ...initial, three: "loading" }, { ...initial, three: "ready" })).toBe(
    "3D board ready",
  );
  expect(announcement(initial, { ...initial, place: "Board, Front copper, Turn 2" })).toBe(
    "Board, Front copper, Turn 2",
  );
  expect(announcement(initial, { ...initial, notice: "Capture attached to your draft." })).toBe(
    "Capture attached to your draft.",
  );
  expect(
    announcement({ ...initial, notice: "Copied" }, { ...initial, notice: "Copied" }),
  ).toBeNull();
  expect(announcement({ ...initial, notice: null }, { ...initial, notice: "Copied" })).toBe(
    "Copied",
  );
});
