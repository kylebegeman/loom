import { AuthOrchestrationOperateScope, AuthSessionId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  queries: new Map<string, { data: unknown; isPending: boolean; error: string | null }>(),
  save: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@t3tools/client-runtime/fork", async () => {
  const { Atom } = await import("effect/reactivity");
  const allowed = Atom.make(true);
  return {
    supportsLoomFeature: () => true,
    createUpstreamSupervisorAtoms: () => ({
      status: () => "status",
      configure: { permissionAtom: () => allowed },
    }),
    createVaultGitHubAtoms: () => ({
      list: () => "github-list",
      info: () => "github-info",
    }),
  };
});
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("~/components/settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    environment: { environmentId: "remote-computer", connection: { phase: "connected" } },
  }),
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () => new Map(),
  useProjects: () => [
    {
      id: "maintenance-project",
      title: "Maintenance",
      workspaceRoot: "/workspace/app",
      environmentId: "remote-computer",
      isScratch: false,
    },
  ],
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/state/auth", () => ({ authEnvironment: { accessChanges: () => "access" } }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: string | null) => ({
    data: query === null ? null : (state.queries.get(query)?.data ?? null),
    isPending: query === null ? false : (state.queries.get(query)?.isPending ?? false),
    error: query === null ? null : (state.queries.get(query)?.error ?? null),
    refresh: state.refresh,
  }),
}));
vi.mock("../vault/state", () => ({ runVault: (...args: unknown[]) => state.save(...args) }));

import { UpstreamSupervisorSettingsSection } from "./SettingsSection";

function setup() {
  state.save.mockReset().mockResolvedValue(undefined);
  state.refresh.mockReset();
  state.queries.clear();
  const connection = {
    item: { id: "a".repeat(32), version: 7, label: "Development GitHub", state: "active" },
    account: "acme",
    repositories: ["acme/other", "acme/app"],
  };
  state.queries.set("status", {
    data: { config: null, workflow: "loom-upstream.yml", mainSha: null, runs: [], receipts: [] },
    isPending: false,
    error: null,
  });
  state.queries.set("access", {
    data: {
      type: "snapshot",
      version: 1,
      revision: 1,
      payload: {
        pairingLinks: [],
        clientSessions: [
          {
            sessionId: AuthSessionId.make("chief-login"),
            subject: "maintenance-chief",
            client: { label: "Grok chief", deviceType: "bot" },
            method: "bearer-access-token",
            scopes: [AuthOrchestrationOperateScope],
            permissions: [AuthOrchestrationOperateScope],
            issuedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
            expiresAt: DateTime.makeUnsafe("2040-01-01T00:00:00Z"),
            lastConnectedAt: null,
            connected: true,
            current: false,
          },
        ],
      },
    },
    isPending: true,
    error: null,
  });
  state.queries.set("github-list", {
    data: { items: [connection], nextCursor: null },
    isPending: false,
    error: null,
  });
  state.queries.set("github-info", { data: connection, isPending: false, error: null });
}

it("saves the chosen chief and GitHub target while the loaded access stream stays subscribed", async () => {
  setup();
  await using screen = await render(<UpstreamSupervisorSettingsSection />, {
    router: "/settings/connections",
  });

  const chief = screen.getByRole("combobox", { name: "Chief login" });
  await expect.element(chief).toBeEnabled();
  await userEvent.click(chief);
  await userEvent.click(page.getByRole("option", { name: /Grok chief/ }));
  await userEvent.click(screen.getByRole("combobox", { name: "Vault GitHub connection" }));
  await userEvent.click(page.getByRole("option", { name: /Development GitHub/ }));
  await expect
    .element(screen.getByRole("button", { name: "Save paused configuration" }))
    .toBeDisabled();
  await userEvent.click(screen.getByRole("combobox", { name: "Repository" }));
  await userEvent.click(page.getByRole("option", { name: "acme/app", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Save paused configuration" }));

  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save.mock.calls[0]?.[1]).toEqual({
    environmentId: "remote-computer",
    input: {
      projectId: "maintenance-project",
      clientSessionId: "chief-login",
      connection: { id: "a".repeat(32), expectedVersion: 7, repository: "acme/app" },
      enabled: false,
    },
  });
});

it("keeps the saved Vault version pinned until the current version is explicitly accepted", async () => {
  setup();
  state.queries.set("status", {
    data: {
      config: {
        projectId: "maintenance-project",
        clientSessionId: "chief-login",
        connection: { id: "a".repeat(32), expectedVersion: 6, repository: "acme/app" },
        enabled: false,
        updatedAt: "2026-01-01T00:00:00Z",
      },
      workflow: "loom-upstream.yml",
      mainSha: null,
      runs: [],
      receipts: [],
    },
    isPending: false,
    error: null,
  });
  await using screen = await render(<UpstreamSupervisorSettingsSection />, {
    router: "/settings/connections",
  });

  const save = screen.getByRole("button", { name: "Save paused configuration" });
  await expect.element(save).toBeDisabled();
  await userEvent.click(screen.getByRole("combobox", { name: "Repository" }));
  await userEvent.click(page.getByRole("option", { name: "acme/other", exact: true }));
  await expect.element(save).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Use connection version 7" }));
  await expect.element(save).toBeEnabled();
  await userEvent.click(save);

  expect(state.save).toHaveBeenCalledOnce();
  expect(state.save.mock.calls[0]?.[1]).toEqual({
    environmentId: "remote-computer",
    input: {
      projectId: "maintenance-project",
      clientSessionId: "chief-login",
      connection: { id: "a".repeat(32), expectedVersion: 7, repository: "acme/other" },
      enabled: false,
    },
  });
});
