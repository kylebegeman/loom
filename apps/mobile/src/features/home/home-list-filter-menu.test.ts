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

  it("adds a project scope submenu that selects and clears the same scope as the chips", () => {
    const onProjectChange = vi.fn();
    const menu = buildHomeListFilterMenu({
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething" },
        { key: "environment-1:project-2", label: "Website" },
      ],
      selectedEnvironmentId: null,
      selectedProjectKey: "environment-1:project-1",
      onEnvironmentChange: vi.fn(),
      onProjectChange,
    });

    const projectMenu = menu.items.find(
      (item) => item.type === "submenu" && item.title === "Project",
    );
    expect(menu.items.some((item) => item.title === "Settings")).toBe(false);
    expect(projectMenu).toMatchObject({
      type: "submenu",
      items: [
        { title: "All projects", state: "off" },
        { title: "Codething", state: "on" },
        { title: "Website", state: "off" },
      ],
    });
    if (projectMenu?.type !== "submenu") throw new Error("Expected project submenu");

    projectMenu.items[0]?.onPress();
    projectMenu.items[2]?.onPress();
    expect(onProjectChange).toHaveBeenNthCalledWith(1, null);
    expect(onProjectChange).toHaveBeenNthCalledWith(2, "environment-1:project-2");
  });
});
