import { expect, it } from "vite-plus/test";
import { BearerConnectionTarget } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import type { EnvironmentPresentation } from "~/state/environments";
import { render } from "../../../test/render";
import { ComputerConnectionsHome } from "./ComputerConnectionsHome";
import { ComputersSettingsPage } from "./ComputersSettingsPage";

function computer(id: string): EnvironmentPresentation {
  const environmentId = EnvironmentId.make(id);
  return {
    environmentId,
    label: id,
    entry: {
      target: new BearerConnectionTarget({ environmentId, connectionId: id, label: id }),
      profile: Option.none(),
      enabled: true,
    },
    displayUrl: null,
    relayManaged: false,
    connection: { phase: "offline", error: null, traceId: null },
    serverConfig: null,
  };
}

it("opens the selected computer, keeps its draft across tabs, and returns to the collection after removal", async () => {
  const dorothy = computer("Dorothy");
  const vps = computer("VPS");
  const content = (environments: readonly EnvironmentPresentation[]) => (
    <ComputersSettingsPage supervisor={<p>Supervisor</p>}>
      <ComputerConnectionsHome
        primaryEnvironment={dorothy}
        environments={environments}
        isReady
        discoveredRows={null}
        renderComputerDetails={(environment) => (
          <input aria-label={`Settings for ${environment.label}`} defaultValue="" />
        )}
      />
    </ComputersSettingsPage>
  );
  await using screen = await render(content([dorothy, vps]), { router: "/settings/connections" });
  await screen.getByRole("button", { name: "Open VPS", exact: true }).click();
  await expect.element(screen.getByRole("textbox", { name: "Settings for VPS" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "All computers" })).toHaveFocus();
  await screen.getByRole("textbox", { name: "Settings for VPS" }).fill("Keep this draft");
  await screen.getByRole("tab", { name: "Upstream supervisor", exact: true }).click();
  await screen.getByRole("tab", { name: "Computers", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Settings for VPS" }))
    .toHaveValue("Keep this draft");
  await screen.getByRole("button", { name: "All computers" }).click();
  await expect.element(screen.getByRole("button", { name: "Open VPS", exact: true })).toHaveFocus();
  await screen.getByRole("button", { name: "Open VPS", exact: true }).click();
  await screen.rerender(content([dorothy]));
  await expect
    .element(screen.getByRole("button", { name: "Open Dorothy", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Settings for VPS" }))
    .not.toBeInTheDocument();
  await screen.rerender(content([dorothy, vps]));
  await expect.element(screen.getByRole("button", { name: "Open VPS", exact: true })).toBeVisible();
});
