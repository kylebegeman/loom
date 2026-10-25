// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  ready: true,
  primaryId: null as string | null,
  hosted: false,
  authorityId: "library",
  environments: [] as unknown[],
  projects: new Map<string, readonly LibraryProject[]>(),
  copies: new Map<string, readonly LibraryWorkingCopy[]>(),
  catalogReads: [] as string[],
  infoFailures: new Set<string>(),
}));
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/fork", async (original) => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const Cause = await import("effect/Cause");
  const projects = Atom.family((environmentId: string) => {
    state.catalogReads.push(environmentId);
    return Atom.make(
      environmentId === "library"
        ? AsyncResult.initial<readonly LibraryProject[]>(true)
        : AsyncResult.success(state.projects.get(environmentId) ?? []),
    );
  });
  const copies = Atom.family((environmentId: string) =>
    Atom.make(AsyncResult.success(state.copies.get(environmentId) ?? [])),
  );
  const info = Atom.family((environmentId: string) =>
    Atom.make(() =>
      state.infoFailures.has(environmentId)
        ? AsyncResult.failure(Cause.fail(new Error("Computer unavailable")))
        : AsyncResult.success({
            isAuthority: false,
            destination: {
              environmentId: environmentId === "other-library-host" ? "other-library" : "library",
              url: "https://library.example.test",
            },
          }),
    ),
  );
  const project = Atom.make(AsyncResult.initial<LibraryProject>(true));
  const threads = Atom.make(AsyncResult.success([]));
  return {
    ...(await original<typeof import("@t3tools/client-runtime/fork")>()),
    createProjectLibraryAtoms: () => ({
      projects: ({ environmentId }: { environmentId: string }) => projects(environmentId),
      copies: ({ environmentId }: { environmentId: string }) => copies(environmentId),
      project: () => project,
      info: ({ environmentId }: { environmentId: string }) => info(environmentId),
      threads: () => threads,
    }),
  };
});
vi.mock("~/hooks/useLocalStorage", () => ({
  useLocalStorage: () => [state.authorityId, () => {}],
}));
vi.mock("~/state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: state.ready, presentation: null }),
}));
vi.mock("~/state/environments", () => ({
  projectEnvironmentPresentation: vi.fn(),
  usePrimaryEnvironmentId: () => state.primaryId,
  useEnvironments: () => ({ environments: state.environments, isReady: state.ready }),
}));
vi.mock("~/state/session", () => ({
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: false }),
}));
vi.mock("~/hostedPairing", () => ({ isHostedStaticApp: () => state.hosted }));
vi.mock("~/localEnvironment", () => ({ isLocalEnvironmentDisabled: () => false }));

import { useLibraryAccessBlock, useLibraryProjects, useLibraryProject } from "./state";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";

let root: Root;
let container: HTMLDivElement;
function Probe() {
  const block = useLibraryAccessBlock(EnvironmentId.make("library"), [
    { requiredScopes: () => [] },
  ]);
  return <output>{JSON.stringify(block)}</output>;
}
async function renderBlock() {
  await act(() => root.render(<Probe />));
  return JSON.parse(container.textContent ?? "null") as ReturnType<typeof useLibraryAccessBlock>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.environments = [];
  state.projects.clear();
  state.copies.clear();
  state.catalogReads = [];
  state.infoFailures.clear();
  state.ready = true;
  state.primaryId = null;
  state.hosted = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("does not call a saved Library removed while the primary environment is still registering", async () => {
  // The primary can be the Library itself; startup must not flash a reconnect warning.
  expect(await renderBlock()).toBeNull();
});

it("sends a saved Library that left this device to Connections once the catalog is complete", async () => {
  state.primaryId = "desk";
  expect(await renderBlock()).toEqual({
    label: "Your Library",
    message: "Your Library is not connected. Reconnect it to continue.",
    repair: "connection",
    environmentId: "library",
  });
});

it("explains a removed Library right away where no primary environment ever registers", async () => {
  state.hosted = true;
  expect(await renderBlock()).toMatchObject({ repair: "connection" });
  state.ready = false;
  expect(await renderBlock()).toBeNull();
});

it("loads a cold offline start from execution-computer receipts without changing the saved Library", async () => {
  const host = EnvironmentId.make("offline-start-host");
  const project: LibraryProject = {
    id: "local-project",
    title: "Local project",
    brief: "Pinned brief",
    revision: 2,
    resources: [],
    archived: false,
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
  };
  const copy: LibraryWorkingCopy = {
    id: "registered-files",
    projectId: project.id,
    projectRevision: project.revision,
    environmentId: host,
    rootPath: "/work/local-project",
    repositories: [],
    ownership: "borrowed",
    state: "ready",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  state.projects.set(host, [project]);
  state.copies.set(host, [copy, { ...copy, id: "removed", registered: false }]);
  state.environments = [
    {
      environmentId: host,
      entry: { enabled: true },
      connection: { phase: "connected" },
      serverConfig: {
        environment: {
          capabilities: { supportsExecution: true, loomFeatures: ["project-library"] },
        },
      },
    },
  ];
  state.environments.push({
    environmentId: "other-library-host",
    entry: { enabled: true },
    connection: { phase: "connected" },
    serverConfig: {
      environment: { capabilities: { supportsExecution: true, loomFeatures: ["project-library"] } },
    },
  });
  function ProbeStart() {
    const catalog = useLibraryProjects();
    const selected = useLibraryProject(project.id);
    return (
      <output>
        {JSON.stringify({
          authorityId: catalog.authorityId,
          offline: catalog.offline,
          projects: catalog.query.data,
          project: selected.project.data,
          copies: selected.copies.data,
        })}
      </output>
    );
  }
  await act(() => root.render(<ProbeStart />));
  expect(JSON.parse(container.textContent!)).toEqual({
    authorityId: "library",
    offline: true,
    projects: [project],
    project,
    copies: [copy],
  });
  expect(state.catalogReads).toEqual([host, "library"]);
});

it("retries the execution computer's Library identity after a failed offline lookup", async () => {
  const host = EnvironmentId.make("retry-host");
  state.infoFailures.add(host);
  state.environments = [
    {
      environmentId: host,
      entry: { enabled: true },
      connection: { phase: "connected" },
      serverConfig: {
        environment: {
          capabilities: { supportsExecution: true, loomFeatures: ["project-library"] },
        },
      },
    },
  ];
  function RetryCatalog() {
    const { query } = useLibraryProjects();
    return (
      <>
        <button onClick={query.refresh}>Retry</button>
        <output>{JSON.stringify({ error: query.error, projects: query.data })}</output>
      </>
    );
  }
  await act(() =>
    root.render(
      <AppAtomRegistryProvider>
        <RetryCatalog />
      </AppAtomRegistryProvider>,
    ),
  );
  const result = () => JSON.parse(container.querySelector("output")!.textContent!);
  expect(result()).toEqual({ error: "Computer unavailable", projects: null });
  state.infoFailures.clear();
  await act(() => container.querySelector("button")!.click());
  expect(result()).toEqual({ error: null, projects: [] });
});
