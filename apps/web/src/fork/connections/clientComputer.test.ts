import { describe, expect, it, vi } from "vite-plus/test";

import { chooseClientComputer, takeLibraryConnectAfterRestart } from "./clientComputer";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("chooseClientComputer", () => {
  it("stops running agents here and connects a Library once after the restart", async () => {
    const storage = memoryStorage();
    const setLocalEnvironmentEnabled = vi.fn(async () => {});

    await chooseClientComputer({ setLocalEnvironmentEnabled }, storage);

    expect(setLocalEnvironmentEnabled).toHaveBeenCalledExactlyOnceWith(false);
    expect(takeLibraryConnectAfterRestart(storage)).toBe(true);
    // A reload, or a later visit with no computers, never reopens it.
    expect(takeLibraryConnectAfterRestart(storage)).toBe(false);
  });

  it("leaves nothing to resume when the switch fails", async () => {
    const storage = memoryStorage();
    const failure = new Error("Settings are read-only");

    await expect(
      chooseClientComputer(
        { setLocalEnvironmentEnabled: async () => Promise.reject(failure) },
        storage,
      ),
    ).rejects.toBe(failure);

    expect(takeLibraryConnectAfterRestart(storage)).toBe(false);
  });
});
