// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_CLERK_JWT_TEMPLATE=template_root\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_local\nT3CODE_CLERK_JWT_TEMPLATE=template_local\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nT3CODE_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).T3CODE_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
          T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          T3CODE_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      T3CODE_RELAY_URL: "https://ci.example.test",
      VITE_T3CODE_RELAY_URL: "https://ci.example.test",
    });
  });

  it("can exclude root files without changing ordinary development loading", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "EXPO_PUBLIC_SHOWCASE=1\nLOOM_IOS_RELEASE_BUILD=0\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_RELAY_URL=https://local.example.test\n",
    );

    const baseEnv = { LOOM_IOS_RELEASE_BUILD: "1", APP_VARIANT: "production" };
    const isolated = loadRepoEnv({ baseEnv, repoRoot, readFiles: false });
    expect(isolated).toEqual(baseEnv);
    expect(isolated.EXPO_PUBLIC_SHOWCASE).toBeUndefined();
    expect(isolated.VITE_T3CODE_RELAY_URL).toBeUndefined();
    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toMatchObject({
      EXPO_PUBLIC_SHOWCASE: "1",
      LOOM_IOS_RELEASE_BUILD: "0",
      T3CODE_RELAY_URL: "https://local.example.test",
      VITE_T3CODE_RELAY_URL: "https://local.example.test",
    });
  });

  // fork: fleet-connect - A source checkout's env files cannot change prepared release identity.
  it("keeps disabled and configured release builds isolated from source env files", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_local\nT3CODE_RELAY_URL=https://local.example.test\n",
    );
    const disabled = loadRepoEnv({ repoRoot, baseEnv: { T3CODE_RELEASE_PUBLIC_CONFIG: "1" } });
    expect(disabled.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(disabled.T3CODE_RELAY_URL).toBeUndefined();
    const configured = loadRepoEnv({
      repoRoot,
      baseEnv: {
        T3CODE_RELEASE_PUBLIC_CONFIG: "1",
        T3CODE_CLERK_PUBLISHABLE_KEY: "pk_prepared",
        T3CODE_RELAY_URL: "https://prepared.example.test",
      },
    });
    expect(configured.VITE_CLERK_PUBLISHABLE_KEY).toBe("pk_prepared");
    expect(configured.VITE_T3CODE_RELAY_URL).toBe("https://prepared.example.test");
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
