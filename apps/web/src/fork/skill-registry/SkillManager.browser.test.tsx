import { useState } from "react";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
} from "@t3tools/contracts";
import type { SkillFile, SkillRegistryInventory } from "@t3tools/contracts/fork";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({ command: vi.fn(), newThread: vi.fn(), setModel: vi.fn() }));
const environmentId = EnvironmentId.make("studio");
const projectId = ProjectId.make("app");
const instanceId = ProviderInstanceId.make("claude");
const file: SkillFile = {
  key: "/home/user/.agents/skills/sample",
  path: "/home/user/.agents/skills/sample/SKILL.md",
  text: "---\nname: sample\ndescription: Review changes\n---\nOriginal instructions",
  hash: "original",
  validation: {
    name: "sample",
    description: "Review changes",
    userInvocationOnly: false,
    userInvocable: true,
    issues: [],
  },
};
const inventory: SkillRegistryInventory = {
  projectId,
  generatedAt: "2026-10-29T00:00:00Z",
  scanTruncated: false,
  unavailable: [],
  accounts: [
    {
      instanceId,
      driver: ProviderDriverKind.make("claude"),
      label: "Claude",
      homePath: "/home/user/.claude",
      installed: true,
      enabled: true,
    },
  ],
  targets: [
    {
      id: "shared",
      path: "/home/user/.agents/skills",
      realPath: "/home/user/.agents/skills",
      scope: "user",
      label: "All agents",
      seenBy: [instanceId],
      isDefault: true,
    },
  ],
  entries: [
    {
      key: file.key,
      name: "sample",
      description: "Review changes",
      locations: [{ path: file.key, realDir: file.key, viaSymlink: false, rootId: "shared" }],
      visibility: [
        {
          instanceId,
          driver: ProviderDriverKind.make("claude"),
          scope: "user",
          enabled: true,
          userInvocationOnly: false,
          userInvocable: true,
          toggle: "claude",
        },
      ],
      editable: true,
      containsScripts: false,
      modified: false,
      currentHash: "tree",
      problems: [],
      install: {
        id: "sample-install",
        directory: file.key,
        name: "sample",
        sourceId: null,
        sourceUrl: "lab",
        subpath: "sample",
        installedAt: "2026-10-29T00:00:00Z",
        hash: "tree",
        commit: null,
      },
    },
  ],
};
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/entities", () => ({
  useProjects: () => [{ id: projectId, environmentId, title: "App" }],
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: inventory, isPending: false, error: null, refresh: vi.fn() }),
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: vi.fn() } }));
vi.mock("~/fork/panels/registry", () => ({ forkPanelSurface: vi.fn() }));
vi.mock("~/hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => state.newThread }));
vi.mock("~/composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  useComposerDraftStore: { getState: () => ({ setModelSelection: state.setModel }) },
}));
vi.mock("./Inventory", () => ({ Inventory: () => null }));
vi.mock("./Sources", () => ({ Sources: () => null }));
vi.mock("../bots/BotModelPicker", () => ({
  BotModelPicker: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button onClick={() => onChange({ instanceId, model: "haiku" })}>Use Claude</button>
  ),
}));
vi.mock("./state", () => {
  const command = (name: string) => ({ name, permissionAtom: () => true });
  return {
    useSkillOperation: () => {
      const [pending, setPending] = useState<string | null>(null);
      const [notice, setNotice] = useState<string | null>(null);
      return {
        pending,
        notice,
        error: null,
        setNotice,
        run: async (label: string, action: () => Promise<unknown>) => {
          setPending(label);
          try {
            return await action();
          } finally {
            setPending(null);
          }
        },
      };
    },
    skills: {
      inventory: () => ({}),
      sources: () => ({}),
      readSkill: command("read"),
      writeSkill: command("write"),
      scaffold: command("create"),
      validate: command("validate"),
      remove: command("remove"),
    },
    runSkillCommand: (command: { name: string }, input: unknown) =>
      state.command(command.name, input),
  };
});
import SkillManager from "./SkillManager";

function setup() {
  state.command.mockReset().mockImplementation(async (name: string) => {
    if (name === "read") return file;
    if (name === "validate") return file.validation;
    if (name === "remove") return { trashPath: "/home/user/trash/sample" };
    throw new Error(`Unexpected command: ${name}`);
  });
  state.newThread.mockReset().mockResolvedValue({ draftId: "draft" });
  state.setModel.mockReset();
}
async function openSkill() {
  await userEvent.click(page.getByRole("combobox", { name: "Editable skill" }));
  await userEvent.click(page.getByRole("option", { name: `sample (${file.key})` }));
  await expect
    .element(page.getByRole("textbox", { name: "SKILL.md editor" }))
    .toHaveValue(file.text);
}

it("keeps unsaved edits when creating and clears the project lock after removal", async () => {
  setup();
  await using screen = await render(
    <SkillManager environmentId={environmentId} initialProjectId={projectId} initialTab="lab" />,
  );
  await openSkill();
  await userEvent.fill(
    screen.getByRole("textbox", { name: "SKILL.md editor" }),
    `${file.text}\nUnsaved edit`,
  );
  await userEvent.fill(screen.getByRole("textbox", { name: "Skill name", exact: true }), "another");
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Skill description", exact: true }),
    "Review another task",
  );
  await expect
    .element(screen.getByRole("button", { name: "Create skill", exact: true }))
    .toBeDisabled();
  await expect.element(screen.getByRole("combobox", { name: "Project context" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Move to trash", exact: true }));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  // Base UI's closing select leaves an inert pointer layer over the dialog in the test fixture.
  await act(() =>
    (
      page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Move to trash", exact: true })
        .element() as HTMLButtonElement
    ).click(),
  );
  await expect
    .element(screen.getByRole("textbox", { name: "SKILL.md editor" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("combobox", { name: "Project context" })).toBeEnabled();
});

it("protects an in-flight save and uses Claude's invocation syntax for the test draft", async () => {
  setup();
  await using screen = await render(
    <SkillManager environmentId={environmentId} initialProjectId={projectId} initialTab="lab" />,
  );
  await openSkill();
  await userEvent.fill(
    screen.getByRole("textbox", { name: "SKILL.md editor" }),
    `${file.text}\nSaved edit`,
  );
  let finish: ((value: SkillFile) => void) | undefined;
  const saved = { ...file, text: `${file.text}\nSaved edit`, hash: "saved" };
  state.command.mockImplementation(async (name: string) =>
    name === "write"
      ? new Promise<SkillFile>((resolve) => {
          finish = resolve;
        })
      : name === "validate"
        ? file.validation
        : file,
  );
  await expect
    .element(screen.getByRole("button", { name: "Save changes", exact: true }))
    .toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Save changes", exact: true }));
  await expect.element(screen.getByRole("textbox", { name: "SKILL.md editor" })).toBeDisabled();
  await expect.element(screen.getByRole("combobox", { name: "Editable skill" })).toBeDisabled();
  await act(() => finish!(saved));
  await expect.element(screen.getByRole("combobox", { name: "Project context" })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "Use Claude" }));
  await userEvent.fill(
    screen.getByRole("textbox", { name: "Skill test prompt" }),
    "Inspect the change",
  );
  await userEvent.click(screen.getByRole("button", { name: "Test in new thread", exact: true }));
  await vi.waitFor(() =>
    expect(state.newThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prompt: "/sample\n\nInspect the change" }),
    ),
  );
});
