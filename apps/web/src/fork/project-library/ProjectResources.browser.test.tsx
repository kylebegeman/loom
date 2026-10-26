import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryResource, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { ProjectResources } from "./ProjectResources";

const dorothy = EnvironmentId.make("dorothy");
const corbelo: LibraryResource = {
  id: "corbelo",
  kind: "repository",
  title: "corbelo",
  url: null,
  remoteUrl: "https://github.com/kyle/corbelo",
  relativePath: ".",
  defaultBranch: null,
};
const held: LibraryWorkingCopy = {
  id: "copy",
  projectId: "project",
  projectRevision: 1,
  environmentId: dorothy,
  rootPath: "/work/corbelo",
  repositories: [
    {
      resourceId: "corbelo",
      path: "/work/corbelo",
      localProjectId: ProjectId.make("corbelo"),
      branch: null,
      head: null,
    },
  ],
  ownership: "managed",
  state: "ready",
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
};

it("asks again before a second repository moves the root repository a computer holds", async () => {
  const onChange = vi.fn(async (_resources: readonly LibraryResource[]) => true);
  await using _screen = await render(
    <ProjectResources
      resources={[corbelo]}
      copies={[held]}
      hostLabel={() => "Dorothy"}
      canEdit
      busy={false}
      adding
      canStart={false}
      onAddingChange={() => undefined}
      onChange={onChange}
      onStart={() => undefined}
    />,
  );
  await userEvent.fill(
    page.getByRole("textbox", { name: "Add a repository or link" }),
    "github.com/kyle/web",
  );
  await userEvent.click(page.getByRole("button", { name: "Add", exact: true }));
  await expect
    .element(
      page.getByText(
        "This moves corbelo into corbelo/. The copy on Dorothy keeps it at its folder root, so Loom prepares a new copy for work on this project there.",
      ),
    )
    .toBeVisible();
  expect(onChange).not.toHaveBeenCalled();

  await userEvent.click(page.getByRole("button", { name: "Add anyway" }));
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(onChange.mock.calls[0]![0].map((entry) => entry.relativePath)).toEqual(["corbelo", "web"]);
});
