// @effect-diagnostics nodeBuiltinImport:off - Exercises the pre-runtime pnpm hook against disposable filesystem fixtures.
import * as NodeModule from "node:module";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";

const repo = NodePath.resolve(import.meta.dirname, "../..");
const screens = "react-native-screens@5.0.0-t3.48";
const patch = "patches/react-native-screens@5.0.0-t3.48.patch";
const tarball = "apps/mobile/deps/react-native-screens-5.0.0-t3.48.tgz";

function fixture(platform = "linux") {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-pnpmfile-"));
  const manifestPath = NodePath.join(root, "apps/mobile/package.json");
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(repo, "apps/mobile/package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  for (const file of [patch, tarball]) {
    const target = NodePath.join(root, file);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.copyFileSync(NodePath.join(repo, file), target);
  }
  const writeManifest = () => NodeFS.writeFileSync(manifestPath, JSON.stringify(manifest));
  writeManifest();
  const module = { exports: {} };
  NodeVM.runInNewContext(NodeFS.readFileSync(NodePath.join(repo, ".pnpmfile.cjs"), "utf8"), {
    module,
    require: NodeModule.createRequire(import.meta.url),
    __dirname: root,
    process: { platform },
  });
  const hook = module.exports as {
    hooks: {
      updateConfig: (config: {
        patchedDependencies?: Record<string, string> | undefined;
      }) => unknown;
    };
  };
  return {
    root,
    manifest,
    writeManifest,
    update: (patchedDependencies?: Record<string, string>) =>
      hook.hooks.updateConfig({ patchedDependencies }),
    [Symbol.dispose]() {
      NodeFS.rmSync(root, { recursive: true, force: true });
    },
  };
}

it("accepts only the pinned Loom Screens patch and retains Windows architecture support", () => {
  using linux = fixture();
  expect(linux.update({ [screens]: patch })).toEqual({ patchedDependencies: { [screens]: patch } });
  using windows = fixture("win32");
  expect(windows.update({ [screens]: patch })).toMatchObject({
    supportedArchitectures: {
      os: ["current", "linux"],
      cpu: ["current", "x64"],
      libc: ["current", "glibc"],
    },
  });
});

it.each(["tarball", "patch"])(
  "rejects changed %s bytes even when its path and version stay the same",
  (changed) => {
    using f = fixture();
    NodeFS.appendFileSync(
      NodePath.join(f.root, changed === "tarball" ? tarball : patch),
      "changed",
    );
    expect(() => f.update({ [screens]: patch })).toThrow(/ships as a fork tarball/);
  },
);

it.each(["version", "tarball path", "patch path", "missing patch"])(
  "rejects a Screens %s outside the pin",
  (changed) => {
    using f = fixture();
    const patches: Record<string, string> = { [screens]: patch };
    if (changed === "version") {
      delete patches[screens];
      patches["react-native-screens"] = patch;
    } else if (changed === "tarball path") {
      f.manifest.dependencies["react-native-screens"] = "file:deps/updated.tgz";
      f.writeManifest();
    } else if (changed === "patch path") {
      patches[screens] = "patches/other.patch";
    } else {
      NodeFS.rmSync(NodePath.join(f.root, patch));
    }
    expect(() => f.update(patches)).toThrow(/ships as a fork tarball/);
  },
);

it("still rejects other fork tarballs alongside the allowed patch, including scoped packages", () => {
  using f = fixture();
  f.manifest.dependencies["@example/fork"] = "file:deps/example.tgz";
  f.writeManifest();
  for (const key of ["react-native-enriched-markdown", "@example/fork@1.0.0"]) {
    expect(() => f.update({ [screens]: patch, [key]: "patches/other.patch" })).toThrow(key);
  }
});

it("allows ordinary registry patches and partial release workspaces", () => {
  using f = fixture();
  expect(() => f.update({ "registry-package@1.0.0": "patches/other.patch" })).not.toThrow();
  expect(() => f.update()).not.toThrow();
  NodeFS.rmSync(NodePath.join(f.root, "apps/mobile/package.json"));
  expect(() => f.update({ [screens]: patch })).not.toThrow();
});
