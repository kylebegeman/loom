import { expect, it } from "vite-plus/test";
import {
  enabledNavigationTabs,
  resolveSelectedNavigationTab,
} from "../../features/workspace/navigation-tab-order";
import { hiddenNavigationTabsForPlatform } from "./tabs";

it.each([
  { platform: "ios", visible: ["threads", "pullRequests"], selected: "threads" },
  { platform: "android", visible: ["usage", "threads", "pullRequests"], selected: "usage" },
])(
  "preserves navigation when Limits moves out of the $platform tabs",
  ({ platform, visible, selected }) => {
    const order = ["usage", "threads", "pullRequests"];
    const hidden = hiddenNavigationTabsForPlatform(platform);
    expect(enabledNavigationTabs(order, hidden)).toEqual(visible);
    expect(resolveSelectedNavigationTab(order, hidden, "usage")).toBe(selected);
    expect(
      hiddenNavigationTabsForPlatform(platform, ["pullRequests", "removed", "pullRequests"]),
    ).toEqual(platform === "ios" ? ["pullRequests", "usage"] : ["pullRequests"]);
  },
);
