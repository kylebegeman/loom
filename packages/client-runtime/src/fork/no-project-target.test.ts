import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";
import { noProjectTargetEnvironmentId, noProjectWorkspaceRoot } from "./no-project-target.ts";

interface Computer {
  readonly environmentId: EnvironmentId;
  readonly phase: EnvironmentConnectionPhase;
  readonly serverConfig: Pick<ServerConfig, "scratchWorkspaceRoot" | "environment">;
}

const computer = (
  name: string,
  options: { phase?: EnvironmentConnectionPhase; scratch?: boolean; executes?: boolean } = {},
): Computer => {
  const environmentId = EnvironmentId.make(name);
  return {
    environmentId,
    phase: options.phase ?? "connected",
    serverConfig: {
      ...(options.scratch === false ? {} : { scratchWorkspaceRoot: `/home/${name}/scratch` }),
      environment: {
        environmentId,
        label: name,
        platform: { os: "linux", arch: "arm64" },
        serverVersion: "0.0.90",
        orchestrationProtocolVersion: 2,
        capabilities: {
          repositoryIdentity: true,
          ...(options.executes === undefined ? {} : { supportsExecution: options.executes }),
        },
      },
    },
  };
};

const library = computer("library", { executes: false });
const laptop = computer("laptop");
const desk = computer("desk", { executes: true });
const offline = computer("offline", { phase: "offline" });
const noScratch = computer("no-scratch", { scratch: false });

const target = (
  environments: readonly Computer[],
  preferred: readonly (EnvironmentId | null | undefined)[],
) =>
  noProjectTargetEnvironmentId({
    environments,
    canRun: (entry) => noProjectWorkspaceRoot(entry.phase, entry.serverConfig) !== null,
    preferred,
  });

describe("noProjectWorkspaceRoot", () => {
  it("offers a connected computer's scratch folder, including servers that predate the flag", () => {
    expect(noProjectWorkspaceRoot(laptop.phase, laptop.serverConfig)).toBe("/home/laptop/scratch");
    expect(noProjectWorkspaceRoot(desk.phase, desk.serverConfig)).toBe("/home/desk/scratch");
  });

  it("never offers a Library that cannot run work, even though it advertises a folder", () => {
    expect(library.serverConfig.scratchWorkspaceRoot).toBeDefined();
    expect(noProjectWorkspaceRoot(library.phase, library.serverConfig)).toBeNull();
  });

  it("needs a live connection and a scratch folder", () => {
    expect(noProjectWorkspaceRoot(offline.phase, offline.serverConfig)).toBeNull();
    expect(noProjectWorkspaceRoot(noScratch.phase, noScratch.serverConfig)).toBeNull();
    expect(noProjectWorkspaceRoot("connected", null)).toBeNull();
  });
});

describe("noProjectTargetEnvironmentId", () => {
  const all = [library, offline, noScratch, desk, laptop];

  it("starts on the current computer when it can run work", () => {
    expect(target(all, [laptop.environmentId, desk.environmentId])).toBe(laptop.environmentId);
  });

  it("falls back to the next preferred computer, then the first that can in display order", () => {
    expect(target(all, [noScratch.environmentId, laptop.environmentId])).toBe(laptop.environmentId);
    expect(target(all, [offline.environmentId, null, undefined])).toBe(desk.environmentId);
    expect(target(all, [])).toBe(desk.environmentId);
  });

  it("skips the Library even when it is the current and primary computer", () => {
    expect(target(all, [library.environmentId, library.environmentId])).toBe(desk.environmentId);
  });

  it("ignores a preferred id that is not among the computers", () => {
    expect(target([laptop], [EnvironmentId.make("gone")])).toBe(laptop.environmentId);
  });

  it("finds nothing when no computer can run work", () => {
    expect(target([library, offline, noScratch], [library.environmentId])).toBeNull();
    expect(target([], [laptop.environmentId])).toBeNull();
  });
});
