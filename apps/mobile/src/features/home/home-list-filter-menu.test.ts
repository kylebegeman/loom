import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { buildHomeListFilterMenu } from "./home-list-filter-menu";

describe("buildHomeListFilterMenu", () => {
  // fork: project-navigation - Library computer filtering must not mutate a saved thread scope.
  it("offers only computer filters in Projects while preserving the saved thread scope", () => {
    const local = EnvironmentId.make("local");
    const onProjectChange = vi.fn();
    const onEnvironmentChange = vi.fn();
    const menu = buildHomeListFilterMenu({
      navigationView: "projects",
      environments: [{ environmentId: local, label: "Mac" }],
      projects: [{ key: "local:loom", label: "Loom" }],
      selectedEnvironmentId: local,
      selectedProjectKey: "local:loom",
      onProjectChange,
      onEnvironmentChange,
    });
    expect(menu.title).toBe("Project list options");
    expect(menu.accessibilityLabel).toBe("Filter projects");
    expect(menu.items).toHaveLength(1);
    const computerMenu = menu.items[0];
    if (computerMenu?.type !== "submenu") throw new Error("Expected computer submenu");
    computerMenu.items[0]?.onPress();
    computerMenu.items[1]?.onPress();
    expect(onEnvironmentChange).toHaveBeenNthCalledWith(1, null);
    expect(onEnvironmentChange).toHaveBeenNthCalledWith(2, local);
    expect(onProjectChange).not.toHaveBeenCalled();
  });
});
