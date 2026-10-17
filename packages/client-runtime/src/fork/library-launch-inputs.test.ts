import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import {
  LIBRARY_COPY_HEALTH_FEATURE,
  LIBRARY_PROFILE_READINESS_FEATURE,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  MINI_WORKER_READINESS_FEATURE,
  libraryLaunchInputs,
  libraryWorkingThreadCounts,
  type LibraryLaunchHost,
} from "./library-launch-inputs.ts";

const MINI = EnvironmentId.make("mini");
const BOOK = EnvironmentId.make("book");
const OLD = EnvironmentId.make("old");
const SAVED = EnvironmentId.make("saved");
const AT = "2026-10-17T10:00:00.000Z";

const project: LibraryProject = {
  id: "loom",
  title: "Loom",
  brief: "",
  revision: 1,
  archived: false,
  resources: [],
  createdAt: AT,
  updatedAt: AT,
};
const capabilities = (...loomFeatures: string[]) =>
  ({ loomFeatures }) as unknown as ExecutionEnvironmentCapabilities;
const host = (
  environmentId: EnvironmentId,
  overrides: Partial<LibraryLaunchHost> = {},
): LibraryLaunchHost => ({
  environmentId,
  label: environmentId,
  online: true,
  supportsExecution: true,
  capabilities: capabilities(
    LIBRARY_COPY_HEALTH_FEATURE,
    LIBRARY_PROFILE_READINESS_FEATURE,
    MINI_WORKER_READINESS_FEATURE,
  ),
  ...overrides,
});
const copy = (
  id: string,
  environmentId: EnvironmentId,
  overrides: Partial<LibraryWorkingCopy> = {},
): LibraryWorkingCopy => ({
  id,
  projectId: project.id,
  projectRevision: 1,
  environmentId,
  rootPath: `/work/${id}`,
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});
const shell = (
  environmentId: EnvironmentId,
  status: "running" | "waiting" | "idle" | "completed" | null,
  overrides: {
    hasPendingApprovals?: boolean;
    hasPendingUserInput?: boolean;
    pendingSubagentRequest?: "approval" | "user_input" | null;
  } = {},
) => ({
  environmentId,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  runtime:
    status === null
      ? null
      : ({ status } as unknown as Parameters<
          typeof libraryWorkingThreadCounts
        >[0][number]["runtime"]),
  ...overrides,
});

describe("libraryWorkingThreadCounts", () => {
  it("counts running threads per computer, leaving out idle, finished and blocked ones", () => {
    const counts = libraryWorkingThreadCounts([
      shell(MINI, "running"),
      shell(MINI, "waiting"),
      shell(MINI, "idle"),
      shell(MINI, "completed"),
      shell(MINI, null),
      shell(BOOK, "running", { hasPendingApprovals: true }),
      shell(BOOK, "running", { hasPendingUserInput: true }),
      shell(BOOK, "running", { pendingSubagentRequest: "approval" }),
      shell(BOOK, "running"),
    ]);
    expect(counts.get(MINI)).toBe(2);
    expect(counts.get(BOOK)).toBe(1);
    expect(counts.has(OLD)).toBe(false);
  });
});

describe("libraryLaunchInputs", () => {
  const base = {
    project,
    copies: [] as LibraryWorkingCopy[],
    hosts: [host(MINI), host(BOOK, { online: false })],
    remembered: [
      { environmentId: MINI, label: "Remembered Mini", supportsExecution: true },
      { environmentId: SAVED, label: "Saved", supportsExecution: true },
    ],
    workingThreads: new Map([[MINI, 3]]),
  };

  it("lists connected hosts, then remembered computers this client has no entry for as offline", () => {
    expect(libraryLaunchInputs(base).computers).toEqual([
      {
        environmentId: MINI,
        label: MINI,
        online: true,
        supportsExecution: true,
        workingThreads: 3,
      },
      {
        environmentId: BOOK,
        label: BOOK,
        online: false,
        supportsExecution: true,
        workingThreads: 0,
      },
      {
        environmentId: SAVED,
        label: "Saved",
        online: false,
        supportsExecution: true,
        workingThreads: 0,
      },
    ]);
  });

  it("reads live health only for this project's ready copies on online computers that offer it", () => {
    const inputs = libraryLaunchInputs({
      ...base,
      hosts: [...base.hosts, host(OLD, { capabilities: capabilities() })],
      copies: [
        copy("ready", MINI),
        copy("preparing", MINI, { state: "preparing" }),
        copy("other", MINI, { projectId: "other" }),
        copy("offline", BOOK),
        copy("older", OLD),
        copy("remembered", SAVED),
      ],
    });
    expect(inputs.healthTargets).toEqual([{ environmentId: MINI, workingCopyId: "ready" }]);
  });

  it("checks required tools only when the profile lists some, on online computers that can check", () => {
    const hosts = [...base.hosts, host(OLD, { capabilities: capabilities() })];
    expect(libraryLaunchInputs({ ...base, hosts }).readinessEnvironmentIds).toEqual([]);
    expect(
      libraryLaunchInputs({
        ...base,
        hosts,
        project: { ...project, profile: { requiredTools: [{ id: "xcode" }] } },
      }).readinessEnvironmentIds,
    ).toEqual([MINI]);
  });

  it("asks about Mini workers only when the profile allows Mini", () => {
    expect(libraryLaunchInputs(base).miniEnvironmentIds).toEqual([]);
    expect(
      libraryLaunchInputs({ ...base, project: { ...project, profile: { allowMini: true } } })
        .miniEnvironmentIds,
    ).toEqual([MINI]);
  });
});
