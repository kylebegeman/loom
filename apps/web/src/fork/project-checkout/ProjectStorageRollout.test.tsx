import {
  createProjectStorageRolloutController,
  projectStorageRolloutKey,
  type ProjectStorageRolloutController,
  type ProjectStorageRolloutTarget,
  type ProjectStorageRolloutOperations,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview, ProjectCheckoutRetention } from "@t3tools/contracts/fork";
import { act, useSyncExternalStore, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vite-plus/test";
import { ProjectStorageRollout } from "./ProjectStorageRollout";

vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/settings/settingsLayout", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingsRow: ({
    title,
    description,
    status,
    control,
    children,
  }: {
    title: ReactNode;
    description?: ReactNode;
    status?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <article>
      <h3>{title}</h3>
      <p>{description}</p>
      {status}
      {control}
      {children}
    </article>
  ),
}));
vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogPopup: "dialog",
  DialogHeader: "header",
  DialogTitle: "h2",
  DialogDescription: "p",
  DialogPanel: "section",
  DialogFooter: "footer",
}));
vi.mock("~/components/ui/select", () => ({
  Select: "select",
  SelectTrigger: "button",
  SelectValue: "span",
  SelectPopup: "div",
  SelectItem: "option",
}));
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipPopup: () => null,
}));

const a: ProjectStorageRolloutTarget = {
  environmentId: EnvironmentId.make("computer-a"),
  projectId: ProjectId.make("project-a"),
  workspaceRoot: "/work/atlas",
  projectName: "Atlas",
  environmentLabel: "Mac",
  connected: true,
  supported: true,
  canRead: true,
  canAdopt: true,
  canSetRetention: true,
};
const b: ProjectStorageRolloutTarget = {
  ...a,
  environmentId: EnvironmentId.make("computer-b"),
  projectId: ProjectId.make("project-b"),
  workspaceRoot: "/ssd/atlas",
  environmentLabel: "Second computer",
};
const review = (
  target = a,
  patch: Partial<ProjectCheckoutPreview> = {},
): ProjectCheckoutPreview => ({
  projectId: target.projectId,
  workspaceRoot: target.workspaceRoot,
  state: "external",
  ownershipSource: null,
  retention: "inherit",
  head: "revision",
  branch: "main",
  repositoryIdentity: null,
  localFiles: { trackedChanges: 2, untrackedFiles: 1, ignoredFiles: 3, truncated: false },
  blockers: ["Local changes keep this folder protected."],
  reviewToken: `token-${target.projectId}`,
  ...patch,
});
let renderer: ReactTestRenderer | undefined;
let controller: ProjectStorageRolloutController;
let preview: Mock<ProjectStorageRolloutOperations["preview"]>;
let adopt: Mock<ProjectStorageRolloutOperations["adopt"]>;
let setRetention: Mock<ProjectStorageRolloutOperations["setRetention"]>;
function Harness() {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return <ProjectStorageRollout controller={controller} snapshot={snapshot} />;
}
function buttons() {
  return renderer!.root.findAllByType("button");
}
function button(label: string) {
  return buttons().find((node) => node.children.join("") === label)!;
}
function choose(target: ProjectStorageRolloutTarget, value: ProjectCheckoutRetention) {
  renderer!.root
    .findByProps({
      "aria-label": `Storage choice for ${target.projectName} on ${target.environmentLabel} at ${target.workspaceRoot}`,
    })
    .parent!.props.onValueChange(value);
}
async function mount(targets = [a, b]) {
  controller.syncTargets(targets);
  await act(() => {
    renderer = create(<Harness />);
  });
}
async function selectAndReview(targets = [a, b]) {
  await act(async () => {
    for (const target of targets) controller.setSelected(projectStorageRolloutKey(target), true);
    await controller.review();
  });
}
async function confirm() {
  await act(() => button("Confirm choices").props.onClick());
}
async function save(count = 2) {
  await act(async () => {
    button(`Save ${count} ${count === 1 ? "file choice" : "file choices"}`).props.onClick();
    // Await a persisted controller milestone rather than a timer.
    await new Promise<void>((resolve) => {
      if (controller.getSnapshot().phase === "results") return resolve();
      const unsubscribe = controller.subscribe(() => {
        if (controller.getSnapshot().phase === "results") {
          unsubscribe();
          resolve();
        }
      });
    });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  preview = vi.fn<ProjectStorageRolloutOperations["preview"]>(
    async (target: ProjectStorageRolloutTarget) => review(target),
  );
  adopt = vi.fn<ProjectStorageRolloutOperations["adopt"]>(
    async (target: ProjectStorageRolloutTarget, input: { retention: ProjectCheckoutRetention }) =>
      review(target, { state: "managed", ownershipSource: "adopted", retention: input.retention }),
  );
  setRetention = vi.fn<ProjectStorageRolloutOperations["setRetention"]>(
    async (target: ProjectStorageRolloutTarget, input: { retention: ProjectCheckoutRetention }) =>
      review(target, { state: "managed", ownershipSource: "clone", retention: input.retention }),
  );
  controller = createProjectStorageRolloutController({ preview, adopt, setRetention });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  controller.dispose();
  vi.unstubAllGlobals();
});

describe("selected project storage rollout", () => {
  it("requires explicit review and per-folder choices before exact final confirmation", async () => {
    await mount();
    expect(preview).not.toHaveBeenCalled();
    expect(button("Review selected")).toBeUndefined();
    await selectAndReview();
    expect(preview).toHaveBeenCalledTimes(2);
    expect(adopt).not.toHaveBeenCalled();
    expect(button("Confirm choices").props.disabled).toBe(true);
    expect(renderer!.root.findAllByType("option").map((input) => input.props.value)).not.toContain(
      "inherit",
    );
    await act(() => choose(a, "keep"));
    expect(button("Confirm choices").props.disabled).toBe(true);
    await act(() => choose(b, "release-on-settle"));
    await confirm();
    expect(
      renderer!.root.findByProps({ "aria-label": "Working-file choices to confirm" }),
    ).toBeDefined();
    expect(JSON.stringify(renderer!.toJSON())).toContain("/work/atlas");
    expect(JSON.stringify(renderer!.toJSON())).toContain("/ssd/atlas");
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "can remove an eligible working copy immediately",
    );
    expect(adopt).not.toHaveBeenCalled();
    const staleSave = button("Save 2 file choices").props.onClick;
    await act(() => button("Back to review").props.onClick());
    await act(() => staleSave());
    expect(adopt).not.toHaveBeenCalled();
    await confirm();
    await save();
    expect(adopt).toHaveBeenCalledWith(a, {
      projectId: a.projectId,
      reviewToken: "token-project-a",
      retention: "keep",
    });
    expect(adopt).toHaveBeenCalledWith(b, {
      projectId: b.projectId,
      reviewToken: "token-project-b",
      retention: "release-on-settle",
    });
  });

  it("retains completed results and requires fresh review and choice before retrying only the failed folder", async () => {
    await mount();
    await selectAndReview();
    await act(() => {
      choose(a, "keep");
      choose(b, "keep");
    });
    adopt.mockImplementationOnce(async (target) =>
      review(target, { state: "managed", ownershipSource: "adopted", retention: "keep" }),
    );
    adopt.mockRejectedValueOnce(new Error("The folder changed. Review it again."));
    await confirm();
    await save();
    expect(controller.getSnapshot().rows.map((row) => row.status)).toEqual(["saved", "error"]);
    expect(button("Confirm choices").props.disabled).toBe(true);
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "folder changed",
    );
    await act(async () => {
      await controller.review();
    });
    expect(preview.mock.calls.map(([target]) => target.projectId)).toEqual([
      a.projectId,
      b.projectId,
      b.projectId,
    ]);
    expect(button("Confirm choices").props.disabled).toBe(true);
    await act(() => choose(b, "release-on-settle"));
    await confirm();
    await save(1);
    expect(adopt.mock.calls.map(([target]) => target.projectId)).toEqual([
      a.projectId,
      b.projectId,
      b.projectId,
    ]);
    expect(controller.getSnapshot().rows.every((row) => row.status === "saved")).toBe(true);
  });

  it("closes stale confirmation when access changes and permits read-only review without a save choice", async () => {
    await mount([a]);
    await selectAndReview([a]);
    await act(() => choose(a, "keep"));
    await confirm();
    const staleSave = button("Save 1 file choice").props.onClick;
    await act(() => controller.syncTargets([{ ...a, canAdopt: false, canSetRetention: false }]));
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
    await act(() => staleSave());
    expect(adopt).not.toHaveBeenCalled();
    await act(async () => {
      await controller.review();
    });
    expect(renderer!.root.findAllByType("select")).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Settings access is required");
    expect(button("Confirm choices").props.disabled).toBe(true);
  });

  it("shows managed restoration/default choices and blockers without claiming release readiness", async () => {
    preview.mockResolvedValue(
      review(a, { state: "released", ownershipSource: "clone", retention: "release-on-settle" }),
    );
    await mount([a]);
    await selectAndReview([a]);
    expect(renderer!.root.findAllByType("option").map((input) => input.props.value)).toContain(
      "inherit",
    );
    await act(() => choose(a, "keep"));
    await confirm();
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "This restores the working files on this computer",
    );
    await save(1);
    expect(adopt).not.toHaveBeenCalled();
    expect(setRetention).toHaveBeenCalledOnce();
  });
});
