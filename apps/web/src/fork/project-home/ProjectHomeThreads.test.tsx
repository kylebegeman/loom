import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { ThreadId, type ServerConfig } from "@t3tools/contracts";
import { makeThreadFixture } from "~/test-fixtures";
import { ProjectHomeThreads } from "./ProjectHomeThreads";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ProjectHomeSectionId, ProjectHomeThreadRow } from "@t3tools/client-runtime/fork";
const state = vi.hoisted(() => ({ canOperate: true }));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => state.canOperate }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipPopup: () => null,
}));
let renderer: ReactTestRenderer | null = null;
const thread = makeThreadFixture({ title: "Review storage", runtime: null });
const configs = new Map([
  [
    thread.environmentId,
    {
      environment: { capabilities: { threadSettlement: true, threadSnooze: true } },
    } as ServerConfig,
  ],
]);
const labels = new Map([[thread.environmentId, "Mac"]]);
const open = vi.fn();
const action = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.canOperate = true;
  open.mockReset();
  action.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
const mountSections = async (sections: ComponentProps<typeof ProjectHomeThreads>["sections"]) => {
  await act(async () => {
    renderer = create(
      <ProjectHomeThreads
        sections={sections}
        environmentLabels={labels}
        serverConfigs={configs}
        onOpenThread={open}
        onThreadAction={action}
      />,
    );
  });
};
const mount = async (
  rows: readonly ProjectHomeThreadRow<EnvironmentThreadShell>[] = [
    { thread, activity: "ready", connected: true },
  ],
  id: ProjectHomeSectionId = "ready",
) => mountSections([{ id, title: id, rows }]);
const chooseView = async (label: string) => {
  const button = renderer!.root.findAllByType("button").find((item) => item.children[0] === label)!;
  await act(async () => button.props.onClick());
};

describe("project home conversation interaction", () => {
  it("excludes duplicate lifecycle requests and leaves a failed operation retryable", async () => {
    let resolve!: (result: AsyncResult.AsyncResult<void, Error>) => void;
    action.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await mount();
    const settle = () => renderer!.root.findByProps({ "aria-label": "Settle Review storage" });
    await act(async () => {
      settle().props.onClick();
      settle().props.onClick();
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(settle().props.disabled).toBe(true);
    await act(async () => {
      resolve(AsyncResult.failure(Cause.fail(new Error("Computer disconnected"))));
    });
    expect(renderer!.root.findByProps({ role: "alert" }).children).toContain(
      "Computer disconnected",
    );
    expect(settle().props.disabled).toBe(false);
    action.mockResolvedValueOnce(AsyncResult.success(undefined));
    await act(async () => {
      settle().props.onClick();
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  });

  it("offers cached offline conversations for reading without lifecycle mutation", async () => {
    await mount([{ thread, activity: "ready", connected: false }], "offline");
    expect(renderer!.root.findAllByProps({ "aria-label": "Settle Review storage" })).toHaveLength(
      0,
    );
    const row = renderer!.root.findByProps({
      "aria-label": "Open Review storage, Last known, computer offline, Mac",
    });
    await act(async () => row.props.onClick());
    expect(open).toHaveBeenCalledWith({ environmentId: thread.environmentId, threadId: thread.id });
    expect(action).not.toHaveBeenCalled();
  });

  it("searches conversations beyond the first bounded page and resets the visible page", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      thread: makeThreadFixture({
        id: ThreadId.make(`thread-${index}`),
        title: `Conversation ${index}`,
        runtime: null,
      }),
      activity: "ready" as const,
      connected: true,
    }));
    await mount(rows);
    expect(renderer!.root.findAllByType("li")).toHaveLength(12);
    const showMore = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.join("").startsWith("Show 8 more"))!;
    await act(async () => showMore.props.onClick());
    expect(renderer!.root.findAllByType("li")).toHaveLength(20);
    const search = renderer!.root.findByProps({ "aria-label": "Search project conversations" });
    await act(async () => search.props.onChange({ currentTarget: { value: "Conversation 19" } }));
    expect(renderer!.root.findAllByType("li")).toHaveLength(1);
    expect(
      renderer!.root.findByProps({ "aria-label": "Open Conversation 19, Ready to continue, Mac" }),
    ).toBeDefined();
    await act(async () => search.props.onChange({ currentTarget: { value: "" } }));
    expect(renderer!.root.findAllByType("li")).toHaveLength(12);
  });
  it("searches all project history and restores the explicitly chosen view after clearing", async () => {
    const settled = makeThreadFixture({
      id: ThreadId.make("settled-thread"),
      title: "Earlier decision",
      runtime: null,
    });
    await mountSections([
      { id: "ready", title: "Ready", rows: [{ thread, activity: "ready", connected: true }] },
      {
        id: "history",
        title: "History",
        rows: [{ thread: settled, activity: "settled", connected: true }],
      },
    ]);
    await chooseView("History");
    expect(renderer!.root.findAllByType("li")).toHaveLength(1);
    expect(renderer!.root.findByProps({ "aria-label": "Reopen Earlier decision" })).toBeDefined();
    const search = renderer!.root.findByProps({ "aria-label": "Search project conversations" });
    await act(async () => search.props.onChange({ currentTarget: { value: "Review storage" } }));
    expect(renderer!.root.findByProps({ "aria-label": "Settle Review storage" })).toBeDefined();
    expect(renderer!.root.findAllByProps({ "aria-label": "Thread view" })).toHaveLength(0);
    await act(async () =>
      renderer!.root.findByProps({ "aria-label": "Clear thread search" }).props.onClick(),
    );
    expect(renderer!.root.findByProps({ "aria-label": "Reopen Earlier decision" })).toBeDefined();
    expect(renderer!.root.findAllByProps({ "aria-label": "Settle Review storage" })).toHaveLength(
      0,
    );
  });

  it("keeps the All and Snoozed views readable when cached computers are offline", async () => {
    const snoozed = makeThreadFixture({
      id: ThreadId.make("snoozed-thread"),
      title: "Later review",
      runtime: null,
    });
    await mountSections([
      { id: "ready", title: "Ready", rows: [{ thread, activity: "ready", connected: true }] },
      {
        id: "offline",
        title: "Offline",
        rows: [{ thread: snoozed, activity: "snoozed", connected: false }],
      },
    ]);
    await chooseView("All");
    expect(renderer!.root.findAllByType("li")).toHaveLength(2);
    await chooseView("Snoozed");
    expect(renderer!.root.findAllByType("li")).toHaveLength(1);
    const cached = renderer!.root.findByProps({
      "aria-label": "Open Later review, Last known, computer offline, Mac",
    });
    await act(async () => cached.props.onClick());
    expect(open).toHaveBeenCalledWith({
      environmentId: snoozed.environmentId,
      threadId: snoozed.id,
    });
    expect(renderer!.root.findAllByProps({ "aria-label": "Wake Later review" })).toHaveLength(0);
  });
  it("keeps the initial Open view when its last thread settles", async () => {
    await mount();
    await act(async () => {
      renderer!.update(
        <ProjectHomeThreads
          sections={[
            {
              id: "history",
              title: "History",
              rows: [{ thread, activity: "settled", connected: true }],
            },
          ]}
          environmentLabels={labels}
          serverConfigs={configs}
          onOpenThread={open}
          onThreadAction={action}
        />,
      );
    });
    expect(renderer!.root.findAllByType("li")).toHaveLength(0);
    expect(
      renderer!.root
        .findAllByProps({ role: "status" })
        .some(
          (status) => status.children.join("") === "No open threads. Your past work is in History.",
        ),
    ).toBe(true);
    await chooseView("History");
    expect(renderer!.root.findByProps({ "aria-label": "Reopen Review storage" })).toBeDefined();
  });
});
