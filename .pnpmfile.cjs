const fs = require("node:fs");
const path = require("node:path");

// fork: native-tab-bar
const crypto = require("node:crypto");

// fork: native-tab-bar
// Keep the reviewed Loom overlay tied to both inputs; a new archive must fail for review.
function isLoomScreensPatch(key, patch, dependencies) {
  if (
    key !== "react-native-screens@5.0.0-t3.50" ||
    patch !== "patches/react-native-screens@5.0.0-t3.50.patch" ||
    dependencies["react-native-screens"] !== "file:deps/react-native-screens-5.0.0-t3.50.tgz"
  )
    return false;
  try {
    return [
      [
        "apps/mobile/deps/react-native-screens-5.0.0-t3.50.tgz",
        "396cb2ff742b245d15d002ca14734828fe86c88f40f5475af2de00e10418f6e2",
      ],
      [patch, "ff9a93f4e4d306e8a0617375dc0aed64924a73cdd59e1ce69403f865b2fec13a"],
    ].every(
      ([file, digest]) =>
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(__dirname, file)))
          .digest("hex") === digest,
    );
  } catch {
    return false;
  }
}

// Our forks ship as tarballs in apps/mobile/deps. A pnpm patch on one is a second source of
// truth that the next tarball silently drops, so changes go to the fork (apps/mobile/deps/README.md).
function forkTarballPatches(patchedDependencies) {
  const manifestPath = path.join(__dirname, "apps/mobile/package.json");
  // Release staging installs a partial workspace without the mobile app.
  if (!patchedDependencies || !fs.existsSync(manifestPath)) return [];
  const { dependencies = {} } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const forks = Object.keys(dependencies).filter((name) =>
    String(dependencies[name]).startsWith("file:deps/"),
  );
  return Object.keys(patchedDependencies).filter(
    (key) =>
      forks.some((name) => key === name || key.startsWith(`${name}@`)) &&
      // fork: native-tab-bar
      !isLoomScreensPatch(key, patchedDependencies[key], dependencies),
  );
}

module.exports = {
  hooks: {
    updateConfig(config) {
      const forkPatches = forkTarballPatches(config.patchedDependencies);
      if (forkPatches.length > 0) {
        throw new Error(
          `pnpm-workspace.yaml patches ${forkPatches.join(", ")}, which ships as a fork tarball in ` +
            "apps/mobile/deps. Change the fork and replace the tarball instead (apps/mobile/deps/README.md).",
        );
      }
      // Windows installs need Linux x64 glibc binaries because WSL shares node_modules.
      // Keep other platforms native; release scripts set their own architectures.
      // oxlint-disable-next-line t3code/no-global-process-runtime -- pnpm loads this file before any Effect runtime exists.
      if (process.platform !== "win32") return config;
      return {
        ...config,
        supportedArchitectures: {
          os: ["current", "linux"],
          cpu: ["current", "x64"],
          libc: ["current", "glibc"],
        },
      };
    },
  },
};
