import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const environments = vi.hoisted(() => {
  let current: unknown[] = [];
  return {
    setup: (next: unknown[]) => {
      current = next;
    },
    get: () => current,
  };
});
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: environments.get() }),
}));
vi.mock("../state/session", () => ({
  useEnvironmentsWithScope: (entries: ReadonlyArray<{ environmentId: string }>) =>
    new Set(entries.map((entry) => entry.environmentId)),
}));

import { useAddProjectTargets } from "./useAddProjectTargets";

const computer = (id: string, supportsExecution: boolean) => ({
  environmentId: EnvironmentId.make(id),
  label: id,
  connection: { phase: "connected" },
  serverConfig: {
    environment: {
      platform: { machine: "server" },
      capabilities: { projectCloneTracking: true, supportsExecution },
    },
  },
});
const project = {
  environmentId: EnvironmentId.make("dorothy"),
  id: ProjectId.make("project"),
  repositoryIdentity: { locator: { remoteUrl: "https://github.com/example/harbor.git" } },
} as unknown as EnvironmentProject;

function Targets() {
  const targets = useAddProjectTargets(project, []);
  return <output>{targets.map((target) => target.label).join(",")}</output>;
}

describe("useAddProjectTargets", () => {
  it("offers only computers that run work, never a Library", async () => {
    environments.setup([
      computer("dorothy", true),
      computer("remote", true),
      computer("library", false),
    ]);
    // A bare hook probe; nothing here navigates.
    await using screen = await render(<Targets />, { router: false });
    await expect.element(screen.getByText("remote", { exact: true })).toBeInTheDocument();
  });
});
