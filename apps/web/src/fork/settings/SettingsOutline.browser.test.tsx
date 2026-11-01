import { useRef } from "react";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { FoldedSettingsSection } from "~/components/settings/FoldedSettingsSection";
import { SettingsPageContainer } from "~/components/settings/settingsLayout";
import { LoomSettingsOutline } from "./SettingsOutline";

function SettingsOutlineFixture() {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <LoomSettingsOutline contentRef={contentRef} />
      <div ref={contentRef}>
        <SettingsPageContainer scopePresentation="none">
          <FoldedSettingsSection id="advanced" title="Advanced" summary="Optional configuration">
            <p>Advanced controls</p>
          </FoldedSettingsSection>
        </SettingsPageContainer>
      </div>
    </>
  );
}

it("opens a folded section and moves focus to it through the existing search target", async () => {
  await using screen = await render(<SettingsOutlineFixture />);
  await expect.element(screen.getByText("Advanced controls")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "On this page" }).click();
  await page.getByRole("menuitem", { name: "Advanced", exact: true }).click();
  await expect.element(screen.getByText("Advanced controls")).toBeVisible();
  await expect
    .element(page.elementLocator(screen.container.querySelector("#advanced")!))
    .toHaveFocus();
});
