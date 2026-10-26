// @effect-diagnostics nodeBuiltinImport:off -- Clerk calls the adapter outside Effect, and startup must not yield before the bridge registers its scheme.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { TokenStorage } from "@clerk/electron";

export const CLERK_TOKEN_STORE = "clerk-tokens";
const TOKEN_FILE_MODE = 0o600;

export const clerkTokenFile = (stateDir: string) =>
  NodePath.join(stateDir, `${CLERK_TOKEN_STORE}.json`);

export function restrictTokenFile(path: string): void {
  try {
    NodeFS.chmodSync(path, TOKEN_FILE_MODE);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}

// electron-store replaces the file with mode 0666 on every write, so each write restores 0600.
export function ownerOnlyTokenStorage(path: string, inner: TokenStorage): TokenStorage {
  const restrict = <A>(value: A) => {
    restrictTokenFile(path);
    return value;
  };
  return {
    getItem: async (key) => restrict(await inner.getItem(key)),
    setItem: async (key, value) => restrict(await inner.setItem(key, value)),
    removeItem: async (key) => restrict(await inner.removeItem(key)),
  };
}
