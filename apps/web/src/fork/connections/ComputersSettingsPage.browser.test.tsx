import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { FoldedSettingsSection } from "~/components/settings/FoldedSettingsSection";
import { ComputersSettingsPage } from "./ComputersSettingsPage";

it("opens a search-targeted view and preserves its draft when switching views", async () => {
  await using screen = await render(
    <ComputersSettingsPage
      supervisor={
        <FoldedSettingsSection id="loom-upstream-supervisor" title="Supervisor configuration">
          <input aria-label="Draft project" defaultValue="" />
        </FoldedSettingsSection>
      }
    >
      <p>Connected computers</p>
    </ComputersSettingsPage>,
    { router: "/settings/connections" },
  );
  await expect.element(screen.getByText("Connected computers")).toBeVisible();
  await screen.router?.navigate({ hash: "loom-upstream-supervisor" });
  await expect.element(screen.getByRole("textbox", { name: "Draft project" })).toBeVisible();
  await expect
    .element(page.elementLocator(screen.container.querySelector("#loom-upstream-supervisor")!))
    .toHaveFocus();
  await userEvent.fill(screen.getByRole("textbox", { name: "Draft project" }), "Loom");
  await screen.getByRole("tab", { name: "Computers", exact: true }).click();
  await expect.element(screen.getByText("Connected computers")).toBeVisible();
  await screen.getByRole("tab", { name: "Upstream supervisor", exact: true }).click();
  await expect.element(screen.getByRole("textbox", { name: "Draft project" })).toHaveValue("Loom");
});
