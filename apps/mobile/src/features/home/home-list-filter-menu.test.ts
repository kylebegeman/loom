import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

describe("buildHomeListFilterMenuItems", () => {
  // fork: project-navigation - Library computer filtering must not mutate a saved thread scope.
  it("offers only computer filters in Projects while preserving the saved thread scope", () => {
    const local = EnvironmentId.make("local");
    const onProjectChange = vi.fn();
    const onEnvironmentChange = vi.fn();
    const menu = buildHomeListFilterMenuItems({
      navigationView: "projects",
      environments: [{ environmentId: local, label: "Mac" }],
      projects: [{ key: "local:loom", label: "Loom" }],
      selectedEnvironmentId: local,
      selectedProjectKey: "local:loom",
      onProjectChange,
      onEnvironmentChange,
    });
    expect(menu).toHaveLength(1);
    const computerMenu = menu[0];
    if (!computerMenu || !("items" in computerMenu)) throw new Error("Expected computer submenu");
    expect(computerMenu.title).toBe("Computer");
    const [all, localComputer] = computerMenu.items;
    if (!all || !("onPress" in all) || !localComputer || !("onPress" in localComputer)) {
      throw new Error("Expected computer actions");
    }
    all.onPress();
    localComputer.onPress();
    expect(onEnvironmentChange).toHaveBeenNthCalledWith(1, null);
    expect(onEnvironmentChange).toHaveBeenNthCalledWith(2, local);
    expect(onProjectChange).not.toHaveBeenCalled();
  });
});
