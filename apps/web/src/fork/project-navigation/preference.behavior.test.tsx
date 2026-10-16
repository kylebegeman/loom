// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  PROJECT_NAVIGATION_VIEW_KEY,
  toggleProjectNavigationView,
  useProjectNavigationView,
} from "./preference";

const clients = new Map<number, ReturnType<typeof useProjectNavigationView>>();
let renderer: ReactTestRenderer | null = null;

function Client({ id }: { id: number }) {
  const state = useProjectNavigationView();
  useLayoutEffect(() => {
    clients.set(id, state);
  });
  return null;
}

async function mountClients() {
  await act(async () => {
    renderer = create(
      <>
        <Client id={1} />
        <Client id={2} />
      </>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  clients.clear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("project navigation persistence", () => {
  it("repairs a malformed preference and synchronizes mounted navigators", async () => {
    window.localStorage.setItem(PROJECT_NAVIGATION_VIEW_KEY, "broken legacy value");
    await mountClients();
    expect(clients.get(1)?.[0]).toBe("threads");
    expect(clients.get(2)?.[0]).toBe("threads");
    await act(async () => clients.get(1)?.[1]("projects"));
    expect(clients.get(1)?.[0]).toBe("projects");
    expect(clients.get(2)?.[0]).toBe("projects");
    expect(window.localStorage.getItem(PROJECT_NAVIGATION_VIEW_KEY)).toBe("projects");
    await act(async () => renderer?.unmount());
    await mountClients();
    expect(clients.get(1)?.[0]).toBe("projects");
  });

  it("switches both navigators even when storage reads and writes fail", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    await mountClients();
    expect(clients.get(1)?.[0]).toBe("threads");
    await act(async () => clients.get(1)?.[1]("projects"));
    expect(clients.get(1)?.[0]).toBe("projects");
    expect(clients.get(2)?.[0]).toBe("projects");
    await act(async () => clients.get(2)?.[1]("threads"));
    expect(clients.get(1)?.[0]).toBe("threads");
    expect(clients.get(2)?.[0]).toBe("threads");
  });

  it("accepts changes from another tab and ignores unrelated preferences", async () => {
    await mountClients();
    window.localStorage.setItem(PROJECT_NAVIGATION_VIEW_KEY, "projects");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });
    expect(clients.get(1)?.[0]).toBe("threads");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: PROJECT_NAVIGATION_VIEW_KEY }));
    });
    expect(clients.get(1)?.[0]).toBe("projects");
    expect(clients.get(2)?.[0]).toBe("projects");
    window.localStorage.clear();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(clients.get(1)?.[0]).toBe("threads");
  });

  it("flips the stored view for mounted navigators and the next one to mount", async () => {
    await mountClients();
    await act(async () => toggleProjectNavigationView());
    expect(clients.get(1)?.[0]).toBe("projects");
    expect(window.localStorage.getItem(PROJECT_NAVIGATION_VIEW_KEY)).toBe("projects");
    await act(async () => renderer?.unmount());
    renderer = null;
    toggleProjectNavigationView();
    await mountClients();
    expect(clients.get(1)?.[0]).toBe("threads");
  });
});
