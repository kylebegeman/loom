import { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryPreparationPlan,
  LibraryPreparationPlanRequest,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryPreparationPlanMatches,
  libraryPreparationPlanSummary,
} from "./library-preparation-plan.ts";

const input: LibraryPreparationPlanRequest = {
  project: {
    id: "project",
    title: "App",
    revision: 7,
    brief: "",
    archived: false,
    resources: [],
    createdAt: "2026-11-11T00:00:00Z",
    updatedAt: "2026-11-11T00:00:00Z",
  },
  environmentId: EnvironmentId.make("computer"),
};
const plan: LibraryPreparationPlan = {
  projectId: "project",
  projectTitle: "App",
  projectRevision: 7,
  environmentId: input.environmentId,
  execution: "review-only",
  placement: {
    action: "clone",
    rootPath: "/projects/app",
    ownership: "managed",
    reason: "New files",
  },
  repositories: [],
  links: [],
  checks: [],
  secrets: [],
  connections: [],
  scripts: [],
  checkedAt: "2026-11-11T00:00:00Z",
};

describe("preparation plan review", () => {
  it("rejects a plan for another project revision, computer or changed requirements", () => {
    expect(libraryPreparationPlanMatches(plan, input)).toBe(true);
    expect(
      libraryPreparationPlanMatches(plan, { ...input, environmentId: EnvironmentId.make("other") }),
    ).toBe(false);
    expect(
      libraryPreparationPlanMatches(plan, { ...input, project: { ...input.project, revision: 8 } }),
    ).toBe(false);
    expect(
      libraryPreparationPlanMatches(plan, {
        ...input,
        project: { ...input.project, profile: { requiredTools: [{ id: "git" }] } },
      }),
    ).toBe(false);
    expect(
      libraryPreparationPlanMatches(plan, {
        ...input,
        project: {
          ...input.project,
          profile: {
            scripts: [
              {
                id: "setup",
                name: "Setup",
                command: "changed",
                icon: "play",
                runOnWorktreeCreate: false,
              },
            ],
          },
        },
      }),
    ).toBe(false);
    expect(libraryPreparationPlanMatches(plan, { ...input, resourceIds: ["missing"] })).toBe(false);
    const script = {
      id: "check",
      name: "Check",
      command: "vp test",
      icon: "test",
      runOnWorktreeCreate: false,
    } as const;
    expect(
      libraryPreparationPlanMatches(
        { ...plan, scripts: [script] },
        {
          ...input,
          project: { ...input.project, profile: { scripts: [{ ...script, runOnSettle: true }] } },
        },
      ),
    ).toBe(false);
    expect(libraryPreparationPlanMatches({ ...plan, projectId: "another-project" }, input)).toBe(
      false,
    );
    const resource = {
      id: "api",
      title: "API",
      relativePath: ".",
      remoteUrl: null,
      defaultBranch: null,
    };
    expect(
      libraryPreparationPlanMatches(
        { ...plan, repositories: [{ resource, path: plan.placement.rootPath }] },
        {
          ...input,
          project: { ...input.project, resources: [resource] },
          resourceIds: [resource.id, resource.id],
        },
      ),
    ).toBe(false);
  });

  it("keeps unknown tool, connection and secret checks unverified", () => {
    expect(
      libraryPreparationPlanSummary({
        ...plan,
        checks: [{ id: "git", label: "Git", status: "unknown" }],
      }),
    ).toBe("Readiness unverified");
    expect(
      libraryPreparationPlanSummary({
        ...plan,
        connections: [{ name: "work-git", status: "unknown" }],
      }),
    ).toBe("Readiness unverified");
    expect(
      libraryPreparationPlanSummary({ ...plan, secrets: [{ name: "API_KEY", status: "unknown" }] }),
    ).toBe("Readiness unverified");
    expect(
      libraryPreparationPlanSummary({
        ...plan,
        checks: [
          { id: "git", label: "Git", status: "outdated", minimumVersion: "3", version: "2" },
        ],
      }),
    ).toBe("Tools need attention");
    expect(libraryPreparationPlanSummary(plan)).toBe("Review preparation steps");
  });
});
