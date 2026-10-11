// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  findLayerPreset,
  resolveLayerPreset,
  type PcbInspection,
  type PcbLayerState,
  type PcbWorkspace,
} from "@t3tools/contracts/fork";
import { LayersTab } from "./LayersTab";
import { usePcbPreferences } from "./preferences";

const names = ["F.Cu", "In1.Cu", "B.Cu", "F.Fab", "F.Silkscreen", "Edge.Cuts"];
const inspection: PcbInspection = {
  sourceHash: "board-one",
  components: [],
  nets: [],
  layers: names,
  bounds: null,
  mountingHoles: [],
  thickness: 1.6,
  warnings: [],
};
const empty: PcbWorkspace = {
  version: 0,
  views: [],
  layerSets: [],
  measurements: [],
  annotations: [],
  simulations: [],
  variants: [],
  requests: [],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  usePcbPreferences.setState({ hiddenLayerPresets: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  usePcbPreferences.setState({ hiddenLayerPresets: [] });
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text,
  )!;
const menu = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (node) => node.textContent?.trim() === text,
  )!;
async function openOptions() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Preset options"]')!.click(),
  );
}
function props() {
  return {
    inspection,
    view: "pcb" as const,
    layers: resolveLayerPreset(findLayerPreset("copper-only")!, names)!,
    data: empty,
    canSave: false,
    onPreset: vi.fn(),
    onLayers: vi.fn(),
    onShowBoard: vi.fn(),
    mutate: vi.fn(),
  };
}

it("applies presets and hides/shows them without a workspace write grant", async () => {
  const input = props();
  await act(async () => root.render(<LayersTab {...input} />));
  await act(async () => button("Assembly front").click());
  expect(input.onLayers).toHaveBeenLastCalledWith(
    resolveLayerPreset(findLayerPreset("assembly-front")!, names),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Hide Assembly front"]')!.click(),
  );
  expect(usePcbPreferences.getState().hiddenLayerPresets).toEqual(["assembly-front"]);
  expect(button("Assembly front")).toBeUndefined();
  await openOptions();
  await act(async () => menu("Show Assembly front").click());
  expect(usePcbPreferences.getState().hiddenLayerPresets).toEqual([]);
  expect(button("Assembly front")).toBeDefined();
  expect(input.mutate).not.toHaveBeenCalled();
});

it("duplicates resolved presets with distinct ids and names, then enforces the saved-set limit", async () => {
  let data: PcbWorkspace = {
    ...empty,
    layerSets: [{ id: "existing", name: "Assembly front", layers: [] }],
  };
  const input = props();
  const mutate = vi.fn(async (change: (current: PcbWorkspace) => PcbWorkspace) => {
    data = change(data);
  });
  await act(async () => root.render(<LayersTab {...input} canSave data={data} mutate={mutate} />));
  await openOptions();
  await act(async () => menu("Assembly front").click());
  expect(data.layerSets.at(-1)).toEqual({
    id: expect.any(String),
    name: "Assembly front 2",
    layers: resolveLayerPreset(findLayerPreset("assembly-front")!, names),
  });
  expect(new Set(data.layerSets.map((set) => set.id)).size).toBe(data.layerSets.length);
  await act(async () => root.render(<LayersTab {...input} canSave data={data} mutate={mutate} />));
  await openOptions();
  await act(async () => menu("Assembly front").click());
  expect(data.layerSets.at(-1)?.name).toBe("Assembly front 3");
  expect(new Set(data.layerSets.map((set) => set.id)).size).toBe(3);
  data = {
    ...data,
    layerSets: Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      name: String(index),
      layers: [],
    })),
  };
  await act(async () => root.render(<LayersTab {...input} canSave data={data} mutate={mutate} />));
  await openOptions();
  expect(menu("Assembly front").getAttribute("aria-disabled")).toBe("true");
  await act(async () => menu("Assembly front").click());
  expect(mutate).toHaveBeenCalledTimes(2);
});

it("keeps saved sets readable without permission and reconciles stale names on application", async () => {
  const input = props();
  const savedLayers: PcbLayerState[] = [
    { name: "F.Cu", visible: true, opacity: 0.5 },
    { name: "Removed", visible: true, opacity: 1 },
  ];
  await act(async () =>
    root.render(
      <LayersTab
        {...input}
        data={{ ...empty, layerSets: [{ id: "saved", name: "Detail", layers: savedLayers }] }}
      />,
    ),
  );
  await act(async () => button("Detail1").click());
  const applied: readonly PcbLayerState[] = input.onLayers.mock.lastCall![0];
  expect(applied.map((layer) => layer.name)).toEqual(names);
  expect(applied[0]).toEqual(savedLayers[0]);
  expect(applied.slice(1).every((layer) => !layer.visible && layer.opacity === 1)).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Remove Detail"]')!.disabled).toBe(
    true,
  );
});

it("disables unavailable presets and hides the section until KiCad layers exist", async () => {
  const input = props();
  await act(async () => root.render(<LayersTab {...input} />));
  expect(button("Assembly back").disabled).toBe(true);
  await act(async () => button("Assembly back").click());
  expect(input.onLayers).not.toHaveBeenCalled();
  await act(async () =>
    root.render(<LayersTab {...input} inspection={{ ...inspection, layers: [] }} layers={[]} />),
  );
  expect(host.textContent).toContain("Reading board layers");
  expect(host.querySelector('[aria-label="Presets"]')).toBeNull();
});

it("refuses duplicate writes without a workspace write grant", async () => {
  const input = props();
  await act(async () => root.render(<LayersTab {...input} />));
  await openOptions();
  expect(menu("Assembly front").getAttribute("aria-disabled")).toBe("true");
  await act(async () => menu("Assembly front").click());
  expect(input.mutate).not.toHaveBeenCalled();
});
