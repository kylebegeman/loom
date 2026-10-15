import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { APP_LINKING_CONFIG, shouldHandleAppLink } from "./appLinking";

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
