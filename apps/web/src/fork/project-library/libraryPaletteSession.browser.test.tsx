import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { openCommandPalette } from "../../commandPaletteBus";
import { useCommandPaletteMount, useCommandPaletteStore } from "../../commandPaletteStore";
import { installCommandPaletteCommands } from "../../shortcuts/commandPaletteCommands";
import { openLibraryAction } from "./actions";
import { useLibraryPaletteSession } from "./LibraryActionHost";
import { isLibraryPaletteOpen, useLibraryPaletteStore } from "./libraryPaletteSession";

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
}

describe("Library palette session", () => {
  it("the palette shortcut dismisses Library setup instead of opening over it", async () => {
    setup();
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<MountedPalette />, { router: "/" });
    using commands = new DisposableStack();
    commands.defer(
      installCommandPaletteCommands(screen.router!, { keybindings: () => keybindings }),
    );

    await act(() => openLibraryAction("create-project"));
    expect(isLibraryPaletteOpen()).toBe(true);

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(isLibraryPaletteOpen()).toBe(false);
    expect(useCommandPaletteStore.getState().open).toBe(false);

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(useCommandPaletteStore.getState()).toMatchObject({ open: true, mode: "command" });
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
});
