import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { APP_LINKING_CONFIG, restoreDraftLinkState, shouldHandleAppLink } from "./appLinking";

const requireNavigation = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
);
const { getStateFromPath } = requireNavigation(
  NodePath.join(
    NodePath.dirname(requireNavigation.resolve("@react-navigation/core/package.json")),
    "lib/module/getStateFromPath.js",
  ),
) as { getStateFromPath: typeof import("@react-navigation/native").getStateFromPath };

describe("cold app links", () => {
  it.each([
    ["connections/new", "ConnectionsNew"],
    ["threads/computer/thread", "Thread"],
    ["library/projects/durable", "LibraryProject"],
  ])("keeps Threads home beneath %s", (path, destination) => {
    const state = getStateFromPath(path, {
      ...APP_LINKING_CONFIG,
      screens: {
        Home: "",
        Library: "library",
        ConnectionsNew: "connections/new",
        Thread: "threads/:environmentId/:threadId",
        LibraryProject: "library/projects/:projectId",
      },
    });
    expect(state?.routes.map((route) => route.name)).toEqual(["Home", destination]);
    expect(state?.index).toBe(1);
  });
});

describe("shouldHandleAppLink", () => {
  // fork: mobile-identity
  it.each([
    "loom://",
    "loom:///",
    "loom-dev://",
    "loom-preview://",
    "t3code://",
    "t3code:///",
    "t3code-dev://",
    "t3code-preview://",
  ])("ignores scheme-only URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(false);
  });

  it.each([
    "loom://threads/env-1/thread-1",
    "loom-dev://settings/usage?tab=limits",
    "loom-preview://pair?pairingUrl=x",
    "t3code://threads/env-1/thread-1",
    "t3code://pair?pairingUrl=x",
    "t3code-dev://settings/usage?tab=limits",
  ])("handles path-bearing URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(true);
  });

  it.each([
    "loom-dev://expo-development-client/?url=x",
    "loom://expo-sharing/anything",
    "t3code://expo-development-client/?url=x",
    "t3code://expo-sharing/anything",
  ])("ignores lifecycle URL %s", (url) => {
    expect(shouldHandleAppLink(url)).toBe(false);
  });
});

describe("draft deep links", () => {
  it("opens the old draft URL on the thread screen with its draft identity", () => {
    const draft = { projectId: "project-1", environmentId: "env-1", draftId: "draft-1" };
    expect(
      restoreDraftLinkState(
        { routes: [{ name: "Home" }, { name: "Thread", params: draft }] },
        "/new/draft?draftId=draft-1",
      ),
    ).toEqual({
      index: 1,
      routes: [{ name: "Home" }, { name: "Thread", params: { draft } }],
    });
  });

  it.each([
    ["environment", "NewTaskEnvironment"],
    ["branch", "NewTaskBranch"],
    ["files", "NewTaskFiles"],
    ["files/src/index.ts", "NewTaskFile"],
    ["attachments/attachment-1", "NewTaskAttachment"],
    ["settings", "NewTaskThreadSettings"],
  ])("restores a draft beneath its %s screen", (path, name) => {
    const params = { environmentId: "env-1", projectId: "project-1" };
    const target = { name, params };
    expect(
      restoreDraftLinkState({ routes: [{ name: "Home" }, target] }, `/new/draft/${path}`),
    ).toEqual({
      index: 2,
      routes: [{ name: "Home" }, { name: "Thread", params: { draft: params } }, target],
    });
  });

  it("leaves live-thread and project-selection links unchanged", () => {
    const state = { routes: [{ name: "Thread", params: { threadId: "thread-1" } }] };
    expect(restoreDraftLinkState(state, "/threads/env-1/thread-1")).toBe(state);
    expect(restoreDraftLinkState(state, "/new")).toBe(state);
    expect(restoreDraftLinkState(undefined, "/new/draft")).toBeUndefined();
  });
});
