// @vitest-environment jsdom
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  supported: true,
  connected: true,
  canRead: true,
  canAdopt: true,
  canSetRetention: true,
  preview: vi.fn(),
  adopt: vi.fn(),
  setRetention: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: "adopt" | "retention") =>
    atom === "adopt" ? harness.canAdopt : harness.canSetRetention,
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  supportsLoomFeature: () => harness.supported,
  createProjectCheckoutAtoms: () => ({
    preview: "preview",
    adopt: { name: "adopt", permissionAtom: () => "adopt" },
    setRetention: { name: "retention", permissionAtom: () => "retention" },
  }),
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => ({ environment: { capabilities: {} } }),
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    presentation: {
      entry: { enabled: true },
      connection: { phase: harness.connected ? "connected" : "offline" },
    },
  }),
  environmentPresentations: { presentationAtom: () => "presentation" },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => harness.canRead,
  readEnvironmentScope: () => harness.canRead,
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    get: (atom: "adopt" | "retention" | "presentation") =>
      atom === "presentation"
        ? {
            entry: { enabled: true },
            connection: { phase: harness.connected ? "connected" : "offline" },
          }
        : atom === "adopt"
          ? harness.canAdopt
          : harness.canSetRetention,
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { name: "adopt" | "retention" }) =>
    command.name === "adopt" ? harness.adopt : harness.setRetention,
}));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => harness.preview }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({
    title,
    footer,
    children,
  }: {
    title: string;
    footer: string;
    children: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
      <p>{footer}</p>
    </section>
  ),
}));
vi.mock("../../components/MaterialButton", () => ({
  MaterialButton: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ControlPill", () => ({
  ControlPillMenu: ({
    children,
    actions,
    onPressAction,
  }: {
    children: ReactNode;
    actions: Array<{
      id: string;
      title: string;
      state: string;
      attributes: { disabled: boolean };
    }>;
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
  }) => (
    <div>
      {children}
      {actions.map((action) => (
        <button
          key={action.id}
          role="radio"
          aria-checked={action.state === "on"}
          disabled={action.attributes.disabled}
          onClick={() => onPressAction({ nativeEvent: { event: action.id } })}
        >
          {action.title}
        </button>
      ))}
    </div>
  ),
}));

import { ProjectCheckoutSection } from "./ProjectCheckoutSection";

const mac = EnvironmentId.make("mac");
const projectId = ProjectId.make("project");
function preview(overrides: Partial<ProjectCheckoutPreview> = {}): ProjectCheckoutPreview {
  return {
    projectId,
    workspaceRoot: "/projects/example",
    state: "external",
    ownershipSource: null,
    retention: "inherit",
    head: "commit",
    branch: "main",
    localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
    blockers: [],
    reviewToken: "review-token",
    repositoryIdentity: null,
    ...overrides,
  };
}
let container: HTMLDivElement;
let root: Root;
function render(
  props: { environmentId?: EnvironmentId; projectId?: ProjectId; workspaceRoot?: string } = {},
) {
  act(() =>
    root.render(
      <ProjectCheckoutSection
        environmentId={props.environmentId ?? mac}
        projectId={props.projectId ?? projectId}
        workspaceRoot={props.workspaceRoot ?? "/projects/example"}
        computerLabel="Mac"
      />,
    ),
  );
}
function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
  if (!result) throw new Error(`Missing action: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function confirmAdoption() {
  await click("Review working files");
  await click("Review file management");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.supported = true;
  harness.connected = true;
  harness.canRead = true;
  harness.canAdopt = true;
  harness.canSetRetention = true;
  harness.preview.mockReset().mockResolvedValue(AsyncResult.success(preview()));
  harness.adopt.mockReset().mockResolvedValue(
    AsyncResult.success(
      preview({
        state: "managed",
        ownershipSource: "adopted",
        retention: "keep",
        reviewToken: "managed-token",
      }),
    ),
  );
  harness.setRetention.mockReset().mockResolvedValue(
    AsyncResult.success(
      preview({
        state: "managed",
        ownershipSource: "clone",
        retention: "release-on-settle",
        reviewToken: "next-token",
      }),
    ),
  );
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
});

describe("reviewed native project storage management", () => {
  it("does not inspect an offline checkout and rejects a disconnect before confirmation dispatch", async () => {
    harness.connected = false;
    render();
    expect(container.textContent).toContain("Reconnect this computer");
    await click("Review working files");
    expect(harness.preview).not.toHaveBeenCalled();
    harness.connected = true;
    render();
    await confirmAdoption();
    harness.connected = false;
    await click("Allow Loom to manage files");
    expect(harness.adopt).not.toHaveBeenCalled();
    render();
    expect(container.textContent).not.toContain("Allow Loom to manage files");
  });

  it("invalidates an in-flight review when its computer disconnects", async () => {
    let complete!: (value: ReturnType<typeof AsyncResult.success<ProjectCheckoutPreview>>) => void;
    harness.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render();
    await click("Review working files");
    harness.connected = false;
    render();
    await act(async () => complete(AsyncResult.success(preview())));
    expect(container.textContent).toContain("Reconnect this computer");
    expect(container.textContent).not.toContain("Review file management");
    expect(harness.adopt).not.toHaveBeenCalled();
  });

  it("does not inspect or adopt on open, then adopts only after explicit review and confirmation", async () => {
    render();
    expect(harness.preview).not.toHaveBeenCalled();
    expect(harness.adopt).not.toHaveBeenCalled();
    await confirmAdoption();
    expect(harness.preview).toHaveBeenCalledWith({ environmentId: mac, input: { projectId } });
    expect(harness.adopt).not.toHaveBeenCalled();
    await click("Allow Loom to manage files");
    expect(harness.adopt).toHaveBeenCalledWith({
      environmentId: mac,
      input: { projectId, reviewToken: "review-token", retention: "keep" },
    });
    expect(container.textContent).toContain("Loom can now manage these working files.");
    expect(button("Review file preference").disabled).toBe(true);
  });

  it("reviews immediate release consequences and lets the user go back or cancel without adopting", async () => {
    render();
    await click("Review working files");
    await click("Free space when settled");
    await click("Review file management");
    expect(container.textContent).toContain(
      "If work is already settled, Loom may remove this safe, published working copy",
    );
    await click("Back to review");
    expect(button("Free space when settled").getAttribute("aria-checked")).toBe("true");
    await click("Cancel review");
    expect(harness.adopt).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Allow Loom to manage files");
    await confirmAdoption();
    expect(button("Allow Loom to manage files")).toBeDefined();
  });

  it("sends the reviewed release policy only after confirmation", async () => {
    render();
    await click("Review working files");
    await click("Free space when settled");
    await click("Review file management");
    await click("Allow Loom to manage files");
    expect(harness.adopt).toHaveBeenCalledWith({
      environmentId: mac,
      input: { projectId, reviewToken: "review-token", retention: "release-on-settle" },
    });
  });

  it("offers the computer default only for managed folders and saves the explicit menu choice", async () => {
    render();
    await click("Review working files");
    expect(container.textContent).not.toContain("Use computer default");
    await click("Cancel review");
    harness.preview.mockResolvedValueOnce(
      AsyncResult.success(
        preview({ state: "managed", ownershipSource: "clone", retention: "keep" }),
      ),
    );
    await click("Review working files");
    expect(button("Review file preference").disabled).toBe(true);
    await click("Use computer default");
    await click("Review file preference");
    expect(container.textContent).toContain(
      "Saving may free space for work that is already settled",
    );
    expect(harness.setRetention).not.toHaveBeenCalled();
    await click("Save file preference");
    expect(harness.setRetention).toHaveBeenCalledWith({
      environmentId: mac,
      input: { projectId, reviewToken: "review-token", retention: "inherit" },
    });
    expect(harness.adopt).not.toHaveBeenCalled();
  });

  it("rejects permission revocation before a visible confirmation dispatches", async () => {
    render();
    await confirmAdoption();
    harness.canAdopt = false;
    await click("Allow Loom to manage files");
    expect(harness.adopt).not.toHaveBeenCalled();
    render();
    expect(container.textContent).toContain("Settings permission is required");
    expect(container.textContent).not.toContain("Allow Loom to manage files");
  });

  it("requires a fresh review after a stale-review failure", async () => {
    harness.adopt.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("The folder changed. Review again."))),
    );
    render();
    await confirmAdoption();
    await click("Allow Loom to manage files");
    expect(container.textContent).toContain("The folder changed. Review again.");
    expect(container.textContent).not.toContain("Allow Loom to manage files");
    harness.preview.mockResolvedValueOnce(
      AsyncResult.success(preview({ reviewToken: "fresh-token" })),
    );
    await click("Retry file review");
    await click("Review file management");
    await click("Allow Loom to manage files");
    expect(harness.adopt).toHaveBeenLastCalledWith({
      environmentId: mac,
      input: { projectId, reviewToken: "fresh-token", retention: "keep" },
    });
  });

  it("does not transfer an in-flight review to a different host or project", async () => {
    let complete!: (value: ReturnType<typeof AsyncResult.success<ProjectCheckoutPreview>>) => void;
    harness.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    render();
    await click("Review working files");
    render({
      environmentId: EnvironmentId.make("pi"),
      projectId: ProjectId.make("other"),
      workspaceRoot: "/ssd/other",
    });
    await act(async () => complete(AsyncResult.success(preview())));
    expect(container.textContent).toContain("/ssd/other");
    expect(container.textContent).not.toContain("Review file management");
    expect(harness.adopt).not.toHaveBeenCalled();
  });

  it("shows local-work warnings on managed checkouts and supports keeping a released checkout", async () => {
    harness.preview.mockResolvedValue(
      AsyncResult.success(
        preview({
          state: "released",
          ownershipSource: "clone",
          retention: "release-on-settle",
          blockers: ["Unpublished work keeps this checkout on disk."],
        }),
      ),
    );
    harness.setRetention.mockResolvedValue(
      AsyncResult.success(
        preview({ state: "released", ownershipSource: "clone", retention: "keep" }),
      ),
    );
    render();
    await click("Review working files");
    expect(container.textContent).toContain("Your project and conversations remain in Loom.");
    expect(container.textContent).toContain("Unpublished work keeps this checkout on disk.");
    await click("Keep files here");
    await click("Review file preference");
    expect(container.textContent).toContain("restore these working files now");
    await click("Save file preference");
    expect(harness.setRetention).toHaveBeenCalledWith({
      environmentId: mac,
      input: { projectId, reviewToken: "review-token", retention: "keep" },
    });
    expect(harness.adopt).not.toHaveBeenCalled();
  });

  it("shows blocked paths and supports retrying review without offering adoption", async () => {
    harness.preview.mockResolvedValueOnce(
      AsyncResult.success(
        preview({
          state: "blocked",
          reviewToken: null,
          blockers: ["This folder contains another project."],
        }),
      ),
    );
    render();
    await click("Review working files");
    expect(container.textContent).toContain("This folder contains another project.");
    expect(container.textContent).not.toContain("Review file management");
    await click("Review files again");
    expect(container.textContent).toContain("Review file management");
  });

  it("guides old hosts to update and blocks folder requests without read access", async () => {
    harness.supported = false;
    render();
    expect(container.textContent).toContain("Update Loom on this computer");
    await click("Review working files");
    expect(harness.preview).not.toHaveBeenCalled();
    harness.supported = true;
    harness.canRead = false;
    render();
    expect(container.textContent).toContain("Project read permission is required");
    await click("Review working files");
    expect(harness.preview).not.toHaveBeenCalled();
  });
});
