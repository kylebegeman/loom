// @effect-diagnostics nodeBuiltinImport:off - Exercises real file modes in a temp directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { TokenStorage } from "@clerk/electron";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  clerkTokenFile,
  ownerOnlyTokenStorage,
  restrictTokenFile,
} from "./OwnerOnlyTokenStorage.ts";

const directories: Array<string> = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

const tokenFile = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-clerk-tokens-"));
  directories.push(root);
  return clerkTokenFile(root);
};

const mode = (path: string) => NodeFS.statSync(path).mode & 0o777;

// Mirrors electron-store, which replaces the file and then sets mode 0666.
const replaceWorldWritable = (path: string, entries: Record<string, string>) => {
  const temp = `${path}.tmp`;
  NodeFS.writeFileSync(temp, JSON.stringify(entries));
  NodeFS.chmodSync(temp, 0o666);
  NodeFS.renameSync(temp, path);
};

const fakeElectronStore = (path: string): TokenStorage => {
  const entries: Record<string, string> = {};
  return {
    getItem: (key) => {
      if (entries[key]) replaceWorldWritable(path, entries);
      return entries[key] ?? null;
    },
    setItem: (key, value) => {
      entries[key] = value;
      replaceWorldWritable(path, entries);
    },
    removeItem: (key) => {
      delete entries[key];
      replaceWorldWritable(path, entries);
    },
  };
};

describe("ownerOnlyTokenStorage", () => {
  it("keeps the token file owner-only after every write", async () => {
    const path = tokenFile();
    const storage = ownerOnlyTokenStorage(path, fakeElectronStore(path));

    await storage.setItem("session", "enc:one");
    expect(mode(path)).toBe(0o600);
    expect(await storage.getItem("session")).toBe("enc:one");
    expect(mode(path)).toBe(0o600);
    await storage.removeItem("session");
    expect(mode(path)).toBe(0o600);
  });

  it("repairs an existing world-writable file and ignores a missing one", () => {
    const path = tokenFile();
    restrictTokenFile(path);
    expect(NodeFS.existsSync(path)).toBe(false);

    replaceWorldWritable(path, { session: "enc:old" });
    expect(mode(path)).toBe(0o666);
    restrictTokenFile(path);
    expect(mode(path)).toBe(0o600);
  });
});
