import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { act, createContext, use, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  params: { path: ["first", "guide.pdf"] },
  renderedItems: [] as NativeStackHeaderItem[],
  setOptionsCalls: 0,
  openedDocuments: [] as string[],
}));

// Native headers retain the actions materialized when navigation applies options.
vi.mock("@react-navigation/native", () => {
  const navigation = {
    setOptions(options: {
      unstable_headerLeftItems?: () => NativeStackHeaderItem[];
      unstable_headerRightItems?: () => NativeStackHeaderItem[];
      unstable_headerToolbarItems?: () => NativeStackHeaderItem[];
    }) {
      harness.setOptionsCalls += 1;
      harness.renderedItems =
        options.unstable_headerLeftItems?.() ??
        options.unstable_headerRightItems?.() ??
        options.unstable_headerToolbarItems?.() ??
        [];
    },
  };
  return {
    useNavigation: () => navigation,
    useRoute: () => ({ key: "file", name: "ThreadFile", params: harness.params }),
  };
});

import { NativeHeaderToolbar } from "./NativeHeaderToolbar";

let root: Root | null = null;
type Placement = "left" | "right" | "bottom";

function DocumentToolbar(props: { readonly path: string; readonly placement: Placement }) {
  return (
    <NativeHeaderToolbar placement={props.placement}>
      <NativeHeaderToolbar.Menu title="File actions" icon="ellipsis">
        <NativeHeaderToolbar.MenuAction onPress={() => harness.openedDocuments.push(props.path)}>
          Open PDF
        </NativeHeaderToolbar.MenuAction>
      </NativeHeaderToolbar.Menu>
    </NativeHeaderToolbar>
  );
}

function renderDocument(path: string, placement: Placement) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.params = { path: path.split("/") };
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(<DocumentToolbar path={path} placement={placement} />));
}

function openRenderedDocument() {
  const menu = harness.renderedItems[0];
  if (menu?.type !== "menu") throw new Error("Expected the native file menu");
  const action = menu.menu.items[0];
  if (action?.type !== "action") throw new Error("Expected the native Open PDF action");
  action.onPress?.();
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  harness.renderedItems = [];
  harness.setOptionsCalls = 0;
  harness.openedDocuments = [];
  vi.unstubAllGlobals();
});

it.each(["left", "right", "bottom"] as const)(
  "updates the %s header action when switching between documents with the same name",
  (placement) => {
    renderDocument("first/guide.pdf", placement);
    openRenderedDocument();
    renderDocument("second/guide.pdf", placement);
    openRenderedDocument();

    expect(harness.openedDocuments).toEqual(["first/guide.pdf", "second/guide.pdf"]);
  },
);

it.each(["left", "right", "bottom"] as const)(
  "does not reapply %s header options for equivalent document renders",
  (placement) => {
    renderDocument("first/guide.pdf", placement);
    const applied = harness.setOptionsCalls;
    renderDocument("first/guide.pdf", placement);
    renderDocument("first/guide.pdf", placement);

    expect(harness.setOptionsCalls).toBe(applied);
    openRenderedDocument();
    expect(harness.openedDocuments).toEqual(["first/guide.pdf"]);
  },
);

// fork: header-elements
// Like React Navigation's LinkingContext, whose default value throws when read
// outside its provider. React restores that default after rendering, so walking
// a development element's owner fiber reaches the throwing getter.
const ProviderOnlyContext = createContext<{ readonly options: object }>({
  get options(): object {
    throw new Error("Read outside its provider");
  },
});

const providedValue = { options: {} };

function ProviderOnlyReader(props: { readonly children: ReactNode }) {
  use(ProviderOnlyContext);
  return props.children;
}

function LoadingToolbar(props: { readonly placement: Placement }) {
  return (
    <ProviderOnlyContext value={providedValue}>
      <ProviderOnlyReader>
        <NativeHeaderToolbar placement={props.placement}>
          <NativeHeaderToolbar.Custom>
            <span>Loading</span>
          </NativeHeaderToolbar.Custom>
        </NativeHeaderToolbar>
      </ProviderOnlyReader>
    </ProviderOnlyContext>
  );
}

it.each(["left", "right", "bottom"] as const)(
  "applies a custom %s header element once without walking its owner",
  (placement) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root ??= createRoot(document.createElement("div"));
    act(() => root!.render(<LoadingToolbar placement={placement} />));
    const applied = harness.setOptionsCalls;
    act(() => root!.render(<LoadingToolbar placement={placement} />));

    expect(applied).toBe(1);
    expect(harness.setOptionsCalls).toBe(applied);
    expect(harness.renderedItems).toMatchObject([{ type: "custom" }]);
  },
);
