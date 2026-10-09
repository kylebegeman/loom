import { describe, expect, it } from "vite-plus/test";

import { rankPanelActions, upstreamSurfaceDescription } from "./rank";
import type { PanelPickerAction } from "./types";

const action = (
  label: string,
  shortcut: string,
  extra: Partial<PanelPickerAction> = {},
): PanelPickerAction => ({
  label,
  shortcut,
  icon: () => null,
  available: true,
  disabledReason: "Unavailable.",
  onClick: () => {},
  ...extra,
});

const actions = [
  action("Browser", "B"),
  action("Terminal", "T"),
  action("Files", "F", { available: false }),
  action("Diff", "D"),
  action("Pull request", "P"),
  action("Linked pull requests", "L"),
  action("Device QA", "Q", { description: "Run flows and collect evidence." }),
];
const labels = (list: ReadonlyArray<PanelPickerAction>) => list.map((entry) => entry.label);

describe("rankPanelActions", () => {
  it("lists recent picks first, then the rest in order, then unavailable surfaces", () => {
    const groups = rankPanelActions(actions, "", ["Diff", "Files", "Device QA", "Missing"]);
    expect(labels(groups.recent)).toEqual(["Diff", "Device QA"]);
    expect(labels(groups.panels)).toEqual([
      "Browser",
      "Terminal",
      "Pull request",
      "Linked pull requests",
    ]);
    expect(labels(groups.unavailable)).toEqual(["Files"]);
  });

  it("caps the recent group at three rows", () => {
    const groups = rankPanelActions(actions, " ", ["Browser", "Terminal", "Diff", "Device QA"]);
    expect(labels(groups.recent)).toEqual(["Browser", "Terminal", "Diff"]);
    expect(labels(groups.panels)).toContain("Device QA");
  });

  it("ranks a one-letter query equal to a surface letter first", () => {
    const groups = rankPanelActions(actions, "t", []);
    expect(labels(groups.panels)[0]).toBe("Terminal");
  });

  it("orders prefix, word start, contains, description and fuzzy matches", () => {
    expect(labels(rankPanelActions(actions, "pull", []).panels)).toEqual([
      "Pull request",
      "Linked pull requests",
    ]);
    expect(labels(rankPanelActions(actions, "evidence", []).panels)).toEqual(["Device QA"]);
    expect(labels(rankPanelActions(actions, "trml", []).panels)).toEqual(["Terminal"]);
    expect(labels(rankPanelActions(actions, "zzz", []).panels)).toEqual([]);
  });

  it("matches upstream surfaces by their fork-owned description", () => {
    expect(labels(rankPanelActions(actions, "shell", []).panels)).toEqual(["Terminal"]);
  });

  it("breaks ties by recency while searching and keeps unavailable matches apart", () => {
    const groups = rankPanelActions(actions, "i", ["Diff"]);
    expect(groups.recent).toEqual([]);
    expect(labels(groups.panels).slice(0, 2)).toEqual(["Diff", "Terminal"]);
    expect(labels(groups.unavailable)).toEqual(["Files"]);
  });
});

describe("upstreamSurfaceDescription", () => {
  it("describes upstream surfaces and nothing else", () => {
    expect(upstreamSurfaceDescription("Device")).toBe(
      "Watch an iOS Simulator or Android Emulator.",
    );
    expect(upstreamSurfaceDescription("Device QA")).toBeUndefined();
  });
});
