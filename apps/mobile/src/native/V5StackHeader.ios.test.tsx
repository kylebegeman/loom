import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { StackHeaderConfigProps } from "react-native-screens";
import { expect, it, vi } from "vite-plus/test";

const bridge = vi.hoisted(() => ({
  ios: undefined as StackHeaderConfigProps["ios"],
  transparent: undefined as StackHeaderConfigProps["transparent"],
  nativeGlass: true,
}));

vi.mock("react-native", () => ({ StyleSheet: { flatten: (style: unknown) => style } }));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardController: { dismiss: vi.fn() },
  useKeyboardState: () => false,
}));
vi.mock("../lib/useMobileNavigationTheme", () => ({
  useMobileNavigationTheme: () => ({ colors: { card: "white" } }),
}));
vi.mock("./native-layout-metrics", () => ({
  useDeviceType: () => "phone",
  useNativeLayoutMetrics: () => null,
}));
vi.mock("./native-glass", () => ({
  get NATIVE_LIQUID_GLASS_SUPPORTED() {
    return bridge.nativeGlass;
  },
}));
vi.mock("react-native-screens", () => ({
  Stack: {
    HeaderConfig: ({ ios, transparent }: StackHeaderConfigProps) => {
      bridge.ios = ios;
      bridge.transparent = transparent;
      return null;
    },
  },
}));

import { V5StackHeader } from "./V5StackHeader.ios";

it("keeps submenu icons and palette layout in the native header menu", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  try {
    act(() =>
      root.render(
        <V5StackHeader
          canGoBack={false}
          options={{
            unstable_headerRightItems: () => [
              {
                type: "menu",
                label: "Tools",
                menu: {
                  layout: "palette",
                  items: [
                    {
                      type: "submenu",
                      label: "Git",
                      icon: { type: "sfSymbol", name: "arrow.triangle.branch" },
                      inline: true,
                      layout: "palette",
                      items: [
                        {
                          type: "action",
                          label: "Changes",
                          state: "on",
                          onPress: () => {},
                        },
                      ],
                    },
                  ],
                },
              },
            ],
          }}
        />,
      ),
    );
    const item = bridge.ios?.trailingItems?.[0];
    if (!item || item.type !== "item" || !("menu" in item))
      throw new Error("Expected a native menu item");
    expect(item.menu?.displayAsPalette).toBe(true);
    expect(item.menu?.children[0]).toMatchObject({
      title: "Git",
      icon: { type: "sfSymbol", name: "arrow.triangle.branch" },
      displayInline: true,
      displayAsPalette: true,
      children: [{ itemType: "action", state: "on" }],
    });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("leaves native glass headers clear for the scroll view's edge effect", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  try {
    for (const nativeGlass of [true, false]) {
      bridge.nativeGlass = nativeGlass;
      act(() =>
        root.render(
          <V5StackHeader
            canGoBack={false}
            options={{
              headerTransparent: false,
              headerShadowVisible: true,
              headerStyle: { backgroundColor: "#f0f0f0" },
              headerTitleStyle: { fontSize: 18, color: "#202020" },
            }}
          />,
        ),
      );
      expect(bridge.transparent).toBe(false);
      for (const appearance of [bridge.ios?.standardAppearance, bridge.ios?.scrollEdgeAppearance]) {
        expect(appearance?.backgroundColor).toBe(nativeGlass ? "transparent" : "#f0f0f0");
        expect(appearance?.shadowColor).toBe(nativeGlass ? "transparent" : undefined);
        expect(appearance?.titleFontSize).toBe(18);
        expect(appearance?.titleFontColor).toBe("#202020");
      }
    }
  } finally {
    bridge.nativeGlass = true;
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each(["leadingItems", "trailingItems", "toolbarItems"] as const)(
  "updates native enabled state after permissions change in %s",
  (placement) => {
    bridge.ios = undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    const onPress = () => {};
    try {
      for (const disabled of [true, false, undefined, true]) {
        const items: NativeStackHeaderItem[] = [
          { type: "button", label: "Files", disabled, onPress },
          {
            type: "menu",
            label: "Terminal",
            disabled,
            menu: { items: [{ type: "action", label: "Open terminal", onPress }] },
          },
        ];
        act(() =>
          root.render(
            <V5StackHeader
              canGoBack={false}
              options={{
                unstable_headerLeftItems: () => (placement === "leadingItems" ? items : []),
                unstable_headerRightItems: () => (placement === "trailingItems" ? items : []),
                unstable_headerToolbarItems: () => (placement === "toolbarItems" ? items : []),
              }}
            />,
          ),
        );
        const nativeItems = (bridge.ios as StackHeaderConfigProps["ios"])?.[placement];
        expect(nativeItems).toHaveLength(2);
        for (const item of nativeItems ?? []) {
          if (item.type !== "item" || "render" in item)
            throw new Error("Expected a native bar item");
          // RNSHeaderContentFactory sets UIBarButtonItem.enabled to !item.disabled.
          expect(!item.disabled).toBe(!disabled);
        }
      }
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);

it.each(["leadingItems", "trailingItems", "toolbarItems"] as const)(
  "separates independent native controls without changing item IDs in %s",
  (placement) => {
    bridge.ios = undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    try {
      for (const sharesBackground of [false, true]) {
        const onPress = () => undefined;
        const items: NativeStackHeaderItem[] = [
          { type: "button", identifier: "first", label: "First", onPress },
          {
            type: "menu",
            identifier: "menu",
            label: "Menu",
            sharesBackground,
            menu: { items: [] },
          },
          { type: "button", identifier: "next", label: "Next", onPress },
          { type: "spacing", spacing: 12 },
          { type: "button", identifier: "done", label: "Done", sharesBackground: false, onPress },
          { type: "button", identifier: "last", label: "Last", onPress },
        ];
        act(() =>
          root.render(
            <V5StackHeader
              canGoBack={false}
              options={{
                unstable_headerLeftItems: () => (placement === "leadingItems" ? items : []),
                unstable_headerRightItems: () => (placement === "trailingItems" ? items : []),
                unstable_headerToolbarItems: () => (placement === "toolbarItems" ? items : []),
              }}
            />,
          ),
        );
        const nativeItems = (bridge.ios as StackHeaderConfigProps["ios"])?.[placement] ?? [];
        expect(nativeItems.map((item) => (item.type === "spacer" ? "space" : item.id))).toEqual(
          sharesBackground
            ? ["first", "menu", "next", "space", "done", "space", "last"]
            : ["first", "space", "menu", "space", "next", "space", "done", "space", "last"],
        );
        expect(nativeItems.filter((item) => item.type === "spacer").map((item) => item.id)).toEqual(
          expect.arrayContaining(["group:last"]),
        );
      }
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
