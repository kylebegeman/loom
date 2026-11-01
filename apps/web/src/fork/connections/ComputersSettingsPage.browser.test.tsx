import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { FoldedSettingsSection } from "~/components/settings/FoldedSettingsSection";
import { ComputersSettingsPage } from "./ComputersSettingsPage";

it("opens a folded section and moves focus to it through the existing search target", async () => {
  await using screen = await render(
    <ComputersSettingsPage>
      <FoldedSettingsSection id="advanced" title="Advanced" summary="Optional configuration">
        <p>Advanced controls</p>
      </FoldedSettingsSection>
    </ComputersSettingsPage>,
  );
  await expect.element(screen.getByText("Advanced controls")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Jump to section" }).click();
  await page.getByRole("menuitem", { name: "Advanced", exact: true }).click();
  await expect.element(screen.getByText("Advanced controls")).toBeVisible();
  await expect
    .element(page.elementLocator(screen.container.querySelector("#advanced")!))
    .toHaveFocus();
});
