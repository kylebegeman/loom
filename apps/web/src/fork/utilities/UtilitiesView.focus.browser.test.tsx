import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { openUtilities } from "./open";
import { useUtilitiesStore } from "./store";
import { UtilitiesDialogHost } from "./UtilitiesDialogHost";
import UtilitiesView from "./UtilitiesView";

vi.mock(import("../routeThread"), () => ({ useRouteThread: () => null }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useUtilitiesStore.setState({ selectedToolId: null, dialogOpen: false, recent: [] });
  container = document.createElement("div");
  container.style.height = "600px";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  localStorage.removeItem("loom:utilities:recent:v1");
  vi.unstubAllGlobals();
});

const heading = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("[data-utility-heading]")].find(
    (element) => element.textContent === label,
  );

async function renderView(width: number) {
  container.style.width = `${width}px`;
  await act(() => root.render(<UtilitiesView />));
}

describe("utilities focus", () => {
  it("keeps focus on the shown pane when the list and tool stack", async () => {
    await renderView(380);
    await userEvent.click(page.getByRole("searchbox", { name: "Search utilities" }));
    await userEvent.keyboard("jwt{Enter}");
    expect(document.activeElement).toBe(heading("JWT decode"));

    await userEvent.click(page.getByRole("button", { name: "All tools" }));
    const active = document.activeElement;
    expect(active?.getAttribute("aria-current")).toBe("true");
    expect(active?.textContent).toBe("JWT decode");
  });

  it("leaves focus on the chosen tool when the list and tool sit side by side", async () => {
    await renderView(640);
    const button = page.getByRole("button", { name: "JWT decode" }).element();
    await userEvent.click(button);
    expect(heading("JWT decode")).toBeDefined();
    expect(document.activeElement).toBe(button);
  });

  it("opens the dialog on the tool's heading and returns focus on Escape", async () => {
    await act(() =>
      root.render(
        <>
          <button type="button">Before</button>
          <UtilitiesDialogHost />
        </>,
      ),
    );
    const before = page.getByRole("button", { name: "Before" }).element() as HTMLElement;
    await act(() => before.focus());

    await act(() => openUtilities("jwt", null));
    // The frame shows at once, before the view's chunk resolves.
    expect(page.getByRole("dialog", { name: "Utilities" }).element()).toBeDefined();
    await vi.waitFor(() => expect(document.activeElement).toBe(heading("JWT decode")));

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(before));
    expect(useUtilitiesStore.getState().dialogOpen).toBe(false);
  });

  it("keeps focus in the dialog when a palette over it switches the tool", async () => {
    const tree = (palette: boolean) => (
      <>
        <button type="button">Before</button>
        <UtilitiesDialogHost />
        {palette ? <PaletteStandIn /> : null}
      </>
    );
    await act(() => root.render(tree(false)));
    await act(() => openUtilities("jwt", null));
    await vi.waitFor(() => expect(document.activeElement).toBe(heading("JWT decode")));

    // Like the command palette with no composer: on close it returns focus to the element that
    // was focused when it opened.
    await act(() => root.render(tree(true)));
    const command = page.getByRole("textbox", { name: "Command" }).element();
    await vi.waitFor(() => expect(document.activeElement).toBe(command));
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(command.isConnected).toBe(false));
    expect(document.activeElement).toBe(heading("UUID"));
  });
});

function PaletteStandIn() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup>
        <DialogTitle>Palette</DialogTitle>
        <input
          aria-label="Command"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            setOpen(false);
            openUtilities("uuid", null);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
