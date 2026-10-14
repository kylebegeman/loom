import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  AuthOrchestrationReadScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import {
  PrimaryConnectionTarget,
  type EnvironmentPresentation,
  type SupervisorConnectionState,
  AVAILABLE_CONNECTION_STATE,
} from "@t3tools/client-runtime/connection";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Option from "effect/Option";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useProjectStorageRollout } from "./useProjectStorageRollout";

const state = vi.hoisted(() => ({
  preview: vi.fn(),
  adopt: vi.fn(),
  retention: vi.fn(),
  query: null as Atom.Writable<AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>> | null,
  permission: null as Atom.Writable<boolean> | null,
  computer: null as Atom.Writable<EnvironmentPresentation | null> | null,
  connection: null as Atom.Writable<
    AsyncResult.AsyncResult<SupervisorConnectionState, Error>
  > | null,
  session: null as Atom.Writable<AsyncResult.AsyncResult<AuthSessionState, Error>> | null,
  project: null as Atom.Writable<{ workspaceRoot: string } | null> | null,
  adoptCommand: { permissionAtom: () => state.permission! },
  retentionCommand: { permissionAtom: () => state.permission! },
}));
vi.mock("./state", () => ({
  PROJECT_CHECKOUT_FEATURE: "project-checkout-management",
  projectCheckouts: {
    preview: () => state.query!,
    adopt: state.adoptCommand,
    setRetention: state.retentionCommand,
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === state.adoptCommand ? state.adopt : state.retention,
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.preview }));
vi.mock("~/state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => state.computer! },
}));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: { stateAtom: () => state.connection! },
}));
vi.mock("~/state/projects", () => ({ environmentProjects: { projectAtom: () => state.project! } }));
vi.mock("~/state/session", () => ({
  environmentSession: { sessionStateAtom: () => state.session! },
}));

const environmentId = EnvironmentId.make("mac");
const projectId = ProjectId.make("atlas");
const inventory = [
  {
    environmentId,
    projectId,
    workspaceRoot: "/work/atlas",
    projectName: "Atlas",
    environmentLabel: "Mac",
    connected: true,
    supported: true,
    canRead: true,
  },
];
const preview: ProjectCheckoutPreview = {
  projectId,
  workspaceRoot: "/work/atlas",
  state: "external",
  ownershipSource: null,
  retention: "inherit",
  head: "revision",
  branch: "main",
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: [],
  reviewToken: "token",
};
const computer: EnvironmentPresentation = {
  entry: {
    target: new PrimaryConnectionTarget({
      environmentId,
      label: "Mac",
      httpBaseUrl: "http://localhost:19973",
      wsBaseUrl: "ws://localhost:19973/ws",
    }),
    profile: Option.none(),
    enabled: true,
  },
  connection: { phase: "connected", error: null, traceId: null },
  serverConfig: {
    environment: { capabilities: { loomFeatures: ["project-checkout-management"] } },
  } as unknown as EnvironmentPresentation["serverConfig"],
};
let renderer: ReactTestRenderer | undefined;
let registry: AtomRegistry.AtomRegistry;
let hook: ReturnType<typeof useProjectStorageRollout>;
let currentInventory = inventory;
function Harness() {
  const result = useProjectStorageRollout(currentInventory);
  useEffect(() => {
    hook = result;
  }, [result]);
  return null;
}
async function mount(input = inventory) {
  currentInventory = input;
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <Harness />
      </RegistryContext.Provider>,
    );
  });
}
async function prepare() {
  await act(async () => {
    const rows = hook.controller.getSnapshot().rows;
    for (const row of rows) hook.controller.setSelected(row.key, true);
    await hook.controller.review();
    for (const row of rows) hook.controller.choose(row.key, "keep");
  });
  return hook.controller.confirm()!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  state.preview.mockReset().mockResolvedValue(AsyncResult.success(preview));
  state.adopt.mockReset().mockResolvedValue(
    AsyncResult.success({
      ...preview,
      state: "managed",
      ownershipSource: "adopted",
      retention: "keep",
    }),
  );
  state.retention.mockReset();
  state.query = Atom.make<AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>>(
    AsyncResult.success(preview),
  );
  state.permission = Atom.make(true);
  state.computer = Atom.make<EnvironmentPresentation | null>(computer);
  state.connection = Atom.make<AsyncResult.AsyncResult<SupervisorConnectionState, Error>>(
    AsyncResult.success<SupervisorConnectionState>({
      ...AVAILABLE_CONNECTION_STATE,
      phase: "connected",
      generation: 1,
    }),
  );
  state.session = Atom.make<AsyncResult.AsyncResult<AuthSessionState, Error>>(
    AsyncResult.success({
      authenticated: true,
      auth: {
        policy: "loopback-browser",
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "qa",
      },
      permissions: [AuthOrchestrationReadScope],
    } satisfies AuthSessionState),
  );
  state.project = Atom.make<{ workspaceRoot: string } | null>({ workspaceRoot: "/work/atlas" });
  vi.spyOn(registry, "refresh").mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("web storage rollout transport guards", () => {
  it("does not preview on mount and sends guarded review and adoption for exact selected identity", async () => {
    await mount();
    expect(state.preview).not.toHaveBeenCalled();
    const plan = await prepare();
    await act(async () => {
      await hook.controller.save(plan);
    });
    expect(state.preview).toHaveBeenCalledExactlyOnceWith({ environmentId, input: { projectId } });
    expect(state.adopt).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "token", retention: "keep" },
    });
  });

  it.each(["folder", "permission", "offline", "generation"] as const)(
    "rejects live %s drift before an old confirmation reaches transport",
    async (condition) => {
      await mount();
      const plan = await prepare();
      await act(async () => {
        if (condition === "folder")
          registry.set(state.project!, { workspaceRoot: "/changed/atlas" });
        if (condition === "permission") registry.set(state.permission!, false);
        if (condition === "offline")
          registry.set(state.computer!, {
            ...computer,
            connection: { phase: "offline", error: null, traceId: null },
          });
        if (condition === "generation")
          registry.set(
            state.connection!,
            AsyncResult.success({
              ...AVAILABLE_CONNECTION_STATE,
              phase: "connected",
              generation: 2,
            }),
          );
        await hook.controller.save(plan);
      });
      expect(state.adopt).not.toHaveBeenCalled();
      expect(hook.controller.getSnapshot().rows[0]!.choice).toBeNull();
      expect(hook.controller.getSnapshot().rows[0]!.preview).toBeNull();
    },
  );

  it("stops unissued mutations on unmount while retaining the issued request's result", async () => {
    const second = {
      ...inventory[0]!,
      projectId: ProjectId.make("second"),
      workspaceRoot: "/work/atlas",
    };
    let resolve: (value: ReturnType<typeof AsyncResult.success<ProjectCheckoutPreview>>) => void;
    state.adopt.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    state.preview.mockImplementation(
      async ({ input }: { input: { projectId: typeof projectId } }) =>
        AsyncResult.success({ ...preview, projectId: input.projectId }),
    );
    await mount([inventory[0]!, second]);
    const plan = await prepare();
    let saving: Promise<void>;
    await act(() => {
      saving = hook.controller.save(plan);
    });
    await act(() => renderer!.unmount());
    renderer = undefined;
    await act(async () => {
      resolve!(
        AsyncResult.success({
          ...preview,
          state: "managed",
          ownershipSource: "adopted",
          retention: "keep",
        }),
      );
      await saving!;
    });
    expect(state.adopt).toHaveBeenCalledOnce();
    expect(hook.controller.getSnapshot().rows[0]!.status).toBe("saved");
    expect(hook.controller.getSnapshot().rows[1]!.status).toBe("reviewed");
  });
});
