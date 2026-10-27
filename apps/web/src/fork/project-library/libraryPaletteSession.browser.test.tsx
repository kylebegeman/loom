import "~/index.css";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { CommandPalette } from "../../components/CommandPalette";
import { openCommandPalette } from "../../commandPaletteBus";
import { useCommandPaletteMount, useCommandPaletteStore } from "../../commandPaletteStore";
import { installCommandPaletteCommands } from "../../shortcuts/commandPaletteCommands";
import { openLibraryAction } from "./actions";
import { useLibraryPaletteSession } from "./LibraryActionHost";
import { LibraryConnectHost } from "./LibraryConnectDialog";
import {
  isLibraryPaletteOpen,
  useLibraryConnectStore,
  useLibraryPaletteStore,
} from "./libraryPaletteSession";

const keybindings = compileResolvedKeybindingsConfig([
  { key: "mod+k", command: "commandPalette.toggle" },
]);

function MountedPalette() {
  useCommandPaletteMount();
  useLibraryPaletteSession();
  return null;
}

function setup() {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  useLibraryPaletteStore.setState(useLibraryPaletteStore.getInitialState(), true);
  useLibraryConnectStore.setState(useLibraryConnectStore.getInitialState(), true);
}

describe("Library palette session", () => {
  it("the palette shortcut dismisses the Library palette instead of opening over it", async () => {
    setup();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<MountedPalette />, { router: "/" });
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );

    await act(() => openLibraryAction("new-conversation"));
    expect(isLibraryPaletteOpen()).toBe(true);

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(isLibraryPaletteOpen()).toBe(false);
    expect(useCommandPaletteStore.getState().open).toBe(false);

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "command" });
  });

  it("without a Library, a new project connects one in its own dialog, not the palette", async () => {
    setup();
    await page.viewport(1280, 720);
    await using _screen = await render(
      <>
        <MountedPalette />
        <LibraryConnectHost />
      </>,
      { router: "/" },
    );

    await act(() => openLibraryAction("create-project"));

    expect(isLibraryPaletteOpen()).toBe(false);
    const dialog = page.getByRole("dialog", { name: "Connect your Library" });
    await userEvent.click(dialog.getByText("Sign in to a Library address"));
    await expect.element(dialog.getByRole("textbox", { name: "Library address" })).toBeInViewport();
  });

  it("a new conversation offers the Library connection as a way out of the palette and back", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>, { router: "/" });

    await act(() => openLibraryAction("new-conversation"));
    await userEvent.click(page.getByRole("option", { name: /Connect your Library/ }));

    expect(isLibraryPaletteOpen()).toBe(false);
    const dialog = page.getByRole("dialog", { name: "Connect your Library" });
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it("a submenu request opens the palette on that submenu", async () => {
    setup();
    await using _screen = await render(<MountedPalette />, { router: "/" });

    openCommandPalette({ submenu: "action:loom:library:go-to-project" });

    expect(useCommandPaletteStore.getState()).toMatchObject({
      open: true,
      openIntent: { kind: "submenu", value: "action:loom:library:go-to-project" },
    });
  });

  it("a submenu request keeps the root list until its submenu exists", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ submenu: "action:loom:library:go-to-project" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect
      .element(page.getByText("No matching commands, projects, or threads."))
      .not.toBeInTheDocument();
  });
});
