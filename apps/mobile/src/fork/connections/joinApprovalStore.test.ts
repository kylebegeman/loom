import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => keychain.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void keychain.set(key, value),
  deleteItemAsync: async (key: string) => void keychain.delete(key),
}));

import { joinApprovalStore, usableJoinApproval } from "./joinApprovalStore";

const library = EnvironmentId.make("library");
const other = EnvironmentId.make("other-library");
const NOW = 1_800_000_000_000;

describe("joinApprovalStore", () => {
  it("releases a token only for its Library and account, and not in its last minute", () => {
    const approvals = {
      [library]: { token: "token", expiresAt: NOW + 120_000, account: "owner" },
    };
    expect(usableJoinApproval(approvals, library, "owner", NOW)).toBe("token");
    expect(usableJoinApproval(approvals, other, "owner", NOW)).toBeNull();
    expect(usableJoinApproval(approvals, library, "someone-else", NOW)).toBeNull();
    expect(usableJoinApproval(approvals, library, null, NOW)).toBeNull();
    expect(usableJoinApproval(approvals, library, "owner", NOW + 60_000)).toBeNull();
  });

  it("keeps each Library's token apart and forgets a refused one", async () => {
    keychain.clear();
    const far = Number.MAX_SAFE_INTEGER;
    await joinApprovalStore.put(library, "owner", { token: "first", expiresAt: far });
    await joinApprovalStore.put(other, null, { token: "second", expiresAt: far });
    expect(await joinApprovalStore.get(library, "owner")).toBe("first");
    await joinApprovalStore.remove(library);
    expect(await joinApprovalStore.get(library, "owner")).toBeNull();
    expect(await joinApprovalStore.get(other, null)).toBe("second");
    await joinApprovalStore.remove(other);
    expect(keychain.size).toBe(0);
  });
});
