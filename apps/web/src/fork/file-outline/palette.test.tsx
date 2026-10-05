import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { useRightPanelStore } from "~/rightPanelStore";
import { filterCommandPaletteGroups } from "~/components/CommandPalette.logic";
import { fileOutlinePaletteSource } from "./palette";
import { useFileOutlineStore } from "./store";

const ref = scopeThreadRef(EnvironmentId.make("outline-e"), ThreadId.make("outline-t"));
const context = { activeThreadRef: ref, loomFeatures: [] };
const source = {
  threadRef: ref,
  path: "/host/file.ts",
  contents: "export function first() {}\nexport function second() {}",
  truncated: false,
};

describe("outline palette", () => {
  beforeEach(() => {
    useFileOutlineStore.setState({ open: false, sources: {}, focusRequestId: 0 });
    useRightPanelStore.setState({ byThreadKey: {} });
    useRightPanelStore.getState().openFile(ref, source.path);
    useFileOutlineStore.getState().publish(scopedThreadKey(ref), source);
  });
  it("works against upstream servers and reveals the chosen symbol, including repeat jumps", async () => {
    const items = fileOutlinePaletteSource.items(context);
    expect(items.map((item) => item.title)).toEqual([
      "Toggle file outline",
      "Go to symbol in file",
    ]);
    const toggle = items[0]!;
    if (toggle.kind !== "action") throw new Error("Missing toggle");
    await toggle.run();
    expect(useFileOutlineStore.getState().open).toBe(true);
    const submenu = items[1]!;
    if (submenu.kind !== "submenu") throw new Error("Missing symbols");
    const symbol = submenu.groups[0]!.items[1]!;
    if (symbol.kind !== "action") throw new Error("Missing symbol");
    await symbol.run();
    const firstReveal =
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(ref)]!.surfaces[0]!;
    expect(firstReveal).toMatchObject({ kind: "file", relativePath: source.path, revealLine: 2 });
    await symbol.run();
    expect(
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(ref)]!.surfaces[0]!,
    ).toMatchObject({
      revealRequestId: "revealRequestId" in firstReveal ? firstReveal.revealRequestId + 1 : 0,
    });
  });
  it.each(["Toggle file outline", "Go to symbol in file"])(
    "finds the command by its displayed title: %s",
    (query) => {
      const groups = filterCommandPaletteGroups({
        activeGroups: [
          { value: "actions", label: "Actions", items: fileOutlinePaletteSource.items(context) },
        ],
        query,
        isInSubmenu: false,
        projectSearchItems: [],
        threadSearchItems: [],
      });
      expect(groups.flatMap((group) => group.items).map((item) => item.title)).toContain(query);
    },
  );
  it("excludes closed panels, other threads and inactive file tabs", () => {
    expect(fileOutlinePaletteSource.items({ ...context, activeThreadRef: null })).toEqual([]);
    useRightPanelStore.getState().openFile(ref, "other.ts");
    expect(fileOutlinePaletteSource.items(context)).toEqual([]);
    useRightPanelStore.getState().openFile(ref, source.path);
    useRightPanelStore.getState().close(ref);
    expect(fileOutlinePaletteSource.items(context)).toEqual([]);
  });
  it("does not apply an old palette action to a newly selected file", async () => {
    const toggle = fileOutlinePaletteSource.items(context)[0]!;
    useRightPanelStore.getState().openFile(ref, "other.ts");
    if (toggle.kind !== "action") throw new Error("Missing toggle");
    await toggle.run();
    expect(useFileOutlineStore.getState().open).toBe(false);
  });
});
