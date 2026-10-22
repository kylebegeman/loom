import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  section: "project-lifecycle",
  active: new Set<string>(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ section: state.section }),
  useNavigate: () => state.navigate,
  Link: "a",
}));
vi.mock("~/components/settings/settingsLayout", () => ({
  SettingsPageContainer: "main",
  useSettingsSearchTarget: () => undefined,
}));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/input-group", () => ({ InputGroup: "div", InputGroupAddon: "span" }));
vi.mock("~/components/ui/select", () => ({
  Select: "select",
  SelectGroup: "optgroup",
  SelectGroupLabel: "span",
  SelectItem: "option",
  SelectPopup: "div",
  SelectTrigger: "button",
  SelectValue: "span",
}));
vi.mock("./registry", async () => {
  const { useEffect, useState } = await import("react");
  function Draft({ name }: { name: string }) {
    const [value, setValue] = useState("");
    useEffect(() => {
      state.active.add(name);
      return () => {
        state.active.delete(name);
      };
    }, [name]);
    return (
      <input aria-label={name} value={value} onChange={(event) => setValue(event.target.value)} />
    );
  }
  return {
    FORK_SETTINGS_SECTIONS: [
      {
        id: "project-lifecycle",
        title: "Storage",
        description: "Storage limits",
        group: "work",
        keywords: "disk",
        Component: () => <Draft name="Storage draft" />,
      },
      {
        id: "vault-github",
        title: "GitHub",
        description: "GitHub connections",
        group: "connections",
        keywords: "repositories",
        Component: () => <Draft name="GitHub draft" />,
      },
    ],
  };
});

import { LoomSettingsPage } from "./LoomSettingsPage";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.section = "project-lifecycle";
  state.active.clear();
  state.navigate.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("retains drafts across topics and pauses inactive topic subscriptions", async () => {
  await act(async () => {
    renderer = create(<LoomSettingsPage />);
  });
  expect(state.active).toEqual(new Set(["Storage draft"]));
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Storage draft" })
      .props.onChange({ target: { value: "Unsaved disk limit" } });
  });
  state.section = "vault-github";
  await act(async () => renderer!.update(<LoomSettingsPage />));
  expect(state.active).toEqual(new Set(["GitHub draft"]));
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "GitHub draft" })
      .props.onChange({ target: { value: "Unsaved connection" } });
  });
  state.section = "project-lifecycle";
  await act(async () => renderer!.update(<LoomSettingsPage />));
  expect(renderer!.root.findByProps({ "aria-label": "Storage draft" }).props.value).toBe(
    "Unsaved disk limit",
  );
  expect(state.active).toEqual(new Set(["Storage draft"]));
  state.section = "vault-github";
  await act(async () => renderer!.update(<LoomSettingsPage />));
  expect(renderer!.root.findByProps({ "aria-label": "GitHub draft" }).props.value).toBe(
    "Unsaved connection",
  );
});

it("keeps a topic draft while search results pause its subscriptions", async () => {
  await act(async () => {
    renderer = create(<LoomSettingsPage />);
  });
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Storage draft" })
      .props.onChange({ target: { value: "Unsaved cap" } });
    renderer!.root
      .findByProps({ "aria-label": "Find Loom settings" })
      .props.onChange({ target: { value: "repositories" } });
  });
  expect(state.active.size).toBe(0);
  expect(renderer!.root.findByProps({ id: "loom-settings-results" })).toBeDefined();
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Find Loom settings" })
      .props.onKeyDown({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
  });
  expect(state.active).toEqual(new Set(["Storage draft"]));
  expect(renderer!.root.findByProps({ "aria-label": "Storage draft" }).props.value).toBe(
    "Unsaved cap",
  );
});

it("opens the first matching topic from search without dropping scope", async () => {
  await act(async () => {
    renderer = create(<LoomSettingsPage />);
  });
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Find Loom settings" })
      .props.onChange({ target: { value: "repositories" } });
  });
  const preventDefault = vi.fn();
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Find Loom settings" })
      .props.onKeyDown({ key: "Enter", preventDefault });
  });
  const options = state.navigate.mock.calls[0]![0];
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(options.search({ machine: "mac", project: "example" })).toEqual({
    machine: "mac",
    project: "example",
    section: "vault-github",
  });
  expect(options.hash).toBe("loom-vault-github");
  expect(renderer!.root.findByProps({ "aria-label": "Find Loom settings" }).props.value).toBe("");
});

it("does not navigate or discard a draft for an unmatched search", async () => {
  await act(async () => {
    renderer = create(<LoomSettingsPage />);
  });
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Find Loom settings" })
      .props.onChange({ target: { value: "no matching topic" } });
  });
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": "Find Loom settings" })
      .props.onKeyDown({ key: "Enter", preventDefault: vi.fn() });
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: "status" }).children.join("")).toContain(
    "No topics match",
  );
});
