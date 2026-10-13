import { EnvironmentId, ProjectId, type RepositoryIdentity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildWorkspaceHandoffDestinations,
  selectWorkspaceHandoffDestination,
  type WorkspaceHandoffComputer,
  type WorkspaceHandoffDestinationProject,
} from "./workspace-handoff-destinations.ts";

const sourceEnvironmentId = EnvironmentId.make("mac");
const pi = EnvironmentId.make("pi");
const mini = EnvironmentId.make("mini");

function repository(
  canonicalKey = "github.com/kylebegeman/loom",
  remoteUrl = "https://github.com/kylebegeman/loom.git",
  originKey?: string,
): RepositoryIdentity {
  return {
    canonicalKey,
    locator: { source: "git-remote", remoteName: originKey ? "upstream" : "origin", remoteUrl },
    ...(originKey ? { origin: { canonicalKey: originKey } } : {}),
  };
}

function computer(
  environmentId = pi,
  overrides: Partial<WorkspaceHandoffComputer> = {},
): WorkspaceHandoffComputer {
  return {
    environmentId,
    label: environmentId,
    connected: true,
    supportsHandoff: true,
    ...overrides,
  };
}

function project(
  id = "loom",
  environmentId = pi,
  repositoryIdentity: RepositoryIdentity | null | undefined = repository(),
): WorkspaceHandoffDestinationProject {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity,
  };
}

function groups(
  input: {
    projects?: ReadonlyArray<WorkspaceHandoffDestinationProject>;
    computers?: ReadonlyArray<WorkspaceHandoffComputer>;
    sourceRepository?: RepositoryIdentity | null;
    offeredRepositoryKey?: string | null;
  } = {},
) {
  return buildWorkspaceHandoffDestinations({
    sourceEnvironmentId,
    sourceRepository: repository(),
    projects: [project()],
    computers: [computer()],
    ...input,
  });
}

describe("workspace handoff computer destinations", () => {
  it("excludes the source computer and groups only its matching destination projects", () => {
    const matching = project();
    const result = groups({
      computers: [computer(sourceEnvironmentId), computer(), computer(mini)],
      projects: [
        project("local", sourceEnvironmentId),
        matching,
        project(
          "other",
          pi,
          repository("github.com/kylebegeman/atlas", "https://github.com/kylebegeman/atlas.git"),
        ),
        project("other-checkout", mini),
      ],
    });
    expect(result.map((group) => group.environmentId)).toEqual([pi, mini]);
    expect(result[0]?.projects).toEqual([
      { project: matching, key: "pi/loom", repositoryVerified: true },
    ]);
    expect(result[1]?.projects[0]?.key).toBe("mini/other-checkout");
  });

  it("matches canonical identities across Git remote protocol, case and suffix differences", () => {
    const result = groups({
      projects: [
        project(
          "ssh",
          pi,
          repository(
            "github.com/KyleBegeman/Loom.git/",
            "ssh://git@github.com/KyleBegeman/Loom.git",
          ),
        ),
      ],
    });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(true);
  });

  it("uses the locator for older identities with a different canonical key", () => {
    const result = groups({
      projects: [
        project("ssh", pi, repository("legacy:loom", "deploy@github.com:KyleBegeman/Loom.git")),
      ],
    });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(true);
  });

  it("normalizes Azure DevOps canonical and SSH identities consistently", () => {
    const result = groups({
      sourceRepository: repository(
        "dev.azure.com/team/product/_git/loom",
        "https://dev.azure.com/team/product/_git/loom",
      ),
      projects: [
        project(
          "azure",
          pi,
          repository(
            "ssh.dev.azure.com/v3/team/product/loom",
            "git@ssh.dev.azure.com:v3/team/product/loom",
          ),
        ),
      ],
    });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(true);
  });

  it("rejects a sibling fork even when it shares the source parent repository", () => {
    const result = groups({
      sourceRepository: repository(
        "github.com/t3tools/loom",
        "https://github.com/t3tools/loom.git",
        "github.com/kylebegeman/loom",
      ),
      projects: [
        project(
          "fork",
          pi,
          repository(
            "github.com/t3tools/loom",
            "https://github.com/t3tools/loom.git",
            "github.com/other/loom",
          ),
        ),
      ],
    });
    expect(result[0]?.projects).toEqual([]);
    expect(result[0]?.blockedReason).toBe("Add this repository on this computer.");
    expect(selectWorkspaceHandoffDestination(result, null)).toBeNull();
  });

  it("keeps the same fork eligible after accepting an offer for its actual remote", () => {
    const sourceRepository = repository(
      "github.com/t3tools/loom",
      "https://github.com/t3tools/loom.git",
      "github.com/kylebegeman/loom",
    );
    const destination = project("fork", pi, sourceRepository);
    const beforeOffer = groups({ sourceRepository, projects: [destination] });
    const afterOffer = groups({
      sourceRepository,
      offeredRepositoryKey: "git@github.com:KyleBegeman/Loom.git",
      projects: [destination],
    });
    expect(selectWorkspaceHandoffDestination(beforeOffer, null)?.key).toBe("pi/fork");
    expect(selectWorkspaceHandoffDestination(afterOffer, "pi/fork")?.repositoryVerified).toBe(true);
  });

  it("matches the checkout remote even if computers have different parent remotes configured", () => {
    const result = groups({
      sourceRepository: repository(
        "github.com/t3tools/loom",
        "https://github.com/t3tools/loom.git",
        "github.com/kylebegeman/loom",
      ),
      projects: [
        project(
          "fork",
          pi,
          repository(
            "github.com/legacy/loom",
            "https://github.com/legacy/loom.git",
            "github.com/KyleBegeman/Loom.git",
          ),
        ),
      ],
    });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(true);
  });

  it("keeps a possible parent tracking remote available only as a manual choice", () => {
    const result = groups({
      sourceRepository: repository(
        "github.com/t3tools/loom",
        "https://github.com/t3tools/loom.git",
        "github.com/kylebegeman/loom",
      ),
      projects: [
        project(
          "parent",
          pi,
          repository("github.com/t3tools/loom", "https://github.com/t3tools/loom.git"),
        ),
      ],
    });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(false);
    expect(selectWorkspaceHandoffDestination(result, null)).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, "pi/parent")?.key).toBe("pi/parent");
  });

  it("uses the offer when the source branch tracks its parent instead of its fork", () => {
    const result = groups({
      sourceRepository: repository(
        "github.com/t3tools/loom",
        "https://github.com/t3tools/loom.git",
        "github.com/kylebegeman/loom",
      ),
      offeredRepositoryKey: "github.com/t3tools/loom",
      projects: [
        project(
          "parent",
          pi,
          repository("github.com/t3tools/loom", "https://github.com/t3tools/loom.git"),
        ),
        project(
          "fork",
          pi,
          repository(
            "github.com/t3tools/loom",
            "https://github.com/t3tools/loom.git",
            "github.com/kylebegeman/loom",
          ),
        ),
      ],
    });
    expect(result[0]?.projects.map((candidate) => candidate.key)).toEqual(["pi/parent"]);
  });

  it("retains canonical identity fallback when no distinct checkout origin is reported", () => {
    const identity = repository();
    const result = groups({
      projects: [
        project("same-origin", pi, {
          ...identity,
          locator: { ...identity.locator, remoteName: "upstream" },
        }),
      ],
    });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(true);
  });

  it("uses the accepted offer repository instead of stale source identity", () => {
    const result = groups({
      offeredRepositoryKey: "github.com/kylebegeman/atlas",
      projects: [
        project("loom"),
        project(
          "atlas",
          pi,
          repository("github.com/kylebegeman/atlas", "https://github.com/kylebegeman/atlas.git"),
        ),
      ],
    });
    expect(result[0]?.projects.map((candidate) => candidate.key)).toEqual(["pi/atlas"]);
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(true);
  });

  it("keeps an unknown destination selectable without presenting it as verified", () => {
    const result = groups({ projects: [project("unknown", pi, null)] });
    expect(result[0]?.blockedReason).toBeNull();
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(false);
    expect(selectWorkspaceHandoffDestination(result, null)).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, "pi/unknown")?.key).toBe("pi/unknown");
  });

  it("allows compatibility choices when source identity is missing, without automatic selection", () => {
    const result = groups({ sourceRepository: null });
    expect(result[0]?.projects[0]?.repositoryVerified).toBe(false);
    expect(selectWorkspaceHandoffDestination(result, undefined)).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, "pi/loom")?.key).toBe("pi/loom");
  });

  it("can verify an offered repository after the source identity is unavailable", () => {
    const result = groups({
      sourceRepository: null,
      offeredRepositoryKey: "git@github.com:kylebegeman/loom.git",
    });
    expect(selectWorkspaceHandoffDestination(result, null)?.key).toBe("pi/loom");
  });

  it("retains offline and outdated computers with an actionable reason", () => {
    const result = groups({
      computers: [computer(pi, { connected: false }), computer(mini, { supportsHandoff: false })],
      projects: [project(), project("loom", mini)],
    });
    expect(result.map((group) => group.blockedReason)).toEqual([
      "Computer is offline.",
      "Update Loom on this computer.",
    ]);
    expect(result.map((group) => group.projects.length)).toEqual([1, 1]);
    expect(selectWorkspaceHandoffDestination(result, "pi/loom")).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, "mini/loom")).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, null)).toBeNull();
  });

  it("only automatically selects a single available verified checkout", () => {
    const result = groups({
      computers: [computer(), computer(mini, { connected: false })],
      projects: [project(), project("unknown", pi, null), project("loom", mini)],
    });
    expect(selectWorkspaceHandoffDestination(result, null)?.key).toBe("pi/loom");
    const ambiguous = groups({ projects: [project(), project("second-checkout")] });
    expect(selectWorkspaceHandoffDestination(ambiguous, null)).toBeNull();
    expect(selectWorkspaceHandoffDestination(ambiguous, "pi/second-checkout")?.key).toBe(
      "pi/second-checkout",
    );
  });

  it("never replaces a stale explicit choice with another computer", () => {
    const result = groups();
    expect(selectWorkspaceHandoffDestination(result, "mini/loom")).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, "")).toBeNull();
    expect(selectWorkspaceHandoffDestination(result, null)?.key).toBe("pi/loom");
  });
});
