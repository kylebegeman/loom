// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type {
  PcbWorkspace,
  PcbChangeRequest,
  PcbChangeRequestOperation,
} from "@t3tools/contracts/fork";
import { RequestsTab } from "./RequestsTab";
const mocks = vi.hoisted(() => ({ run: vi.fn(), permission: true }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.permission }));
vi.mock("./state", () => ({ pcb: { compare: { permissionAtom: () => true } } }));
vi.mock("../model-preview-3d/state", () => ({ runModelCommand: mocks.run }));
const request: PcbChangeRequest = {
  id: "one",
  title: "Move resistor",
  request: "Move R1 left",
  anchor: { kind: "component", reference: "R1" },
  view: "pcb",
  sheet: "board",
  point: { x: 1, y: 2 },
  sourceHash: "old",
  createdAt: "now",
  status: "review",
  baseRef: "base",
  referenceImage: null,
  sentAt: "now",
  response: "Moved R1",
  reviewRevision: "new",
  resolvedRevision: null,
  resolvedRef: null,
  resolvedAt: null,
};
it("reviews the baseline, accepts with a frozen after ref, then reopens without changing baseline", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.permission = true;
  mocks.run.mockReset().mockResolvedValue({
    beforeSvg: null,
    afterSvg: null,
    log: "",
    before: { components: [] },
    after: { components: [] },
    changes: [],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    operations: PcbChangeRequestOperation[] = [];
  function Harness() {
    const [data, setData] = useState<PcbWorkspace>({
      version: 1,
      views: [],
      layerSets: [],
      annotations: [],
      measurements: [],
      simulations: [],
      variants: [],
      requests: [request],
    });
    return (
      <RequestsTab
        data={data}
        ready
        sourceHash="new"
        canSave
        executionAllowed
        threadRef={{ environmentId: EnvironmentId.make("e"), threadId: ThreadId.make("t") }}
        designId="board"
        onDraft={async () => {}}
        onFocus={() => {}}
        onCapture={async () => new Blob()}
        onOperation={async (op) => {
          operations.push(op);
          if (op.op === "status")
            setData({
              ...data,
              requests: data.requests.map((r) => ({
                ...r,
                status: op.status,
                resolvedRef: op.status === "accepted" ? "resolved" : null,
              })),
            });
        }}
      />
    );
  }
  const click = async (label: string) => {
    const b = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
    expect(b).toBeDefined();
    await act(async () => b.click());
  };
  try {
    await act(async () => root.render(<Harness />));
    await click("Move resistorR1 · Ready for review");
    expect(host.textContent).toContain("Response: Moved R1");
    await click("Compare");
    expect(mocks.run.mock.lastCall?.[1].input).toMatchObject({ from: "base", to: "" });
    await click("Accept");
    expect(operations.at(-1)).toMatchObject({ status: "accepted" });
    await click("Compare");
    expect(mocks.run.mock.lastCall?.[1].input).toMatchObject({ from: "base", to: "resolved" });
    await click("Reopen");
    await click("Compare");
    expect(mocks.run.mock.lastCall?.[1].input).toMatchObject({ from: "base", to: "" });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
