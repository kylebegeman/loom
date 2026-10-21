import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { VAULT_PASSWORD_DEFAULTS } from "@t3tools/client-runtime/fork";

const mocks = vi.hoisted(() => ({
  getRandomValues: vi.fn<(bytes: Uint8Array) => Uint8Array>(),
  getRandomBytes: vi.fn<(count: number) => Uint8Array>(),
  setStringAsync: vi.fn(),
}));
vi.mock("expo-crypto", () => ({
  getRandomValues: mocks.getRandomValues,
  getRandomBytes: mocks.getRandomBytes,
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mocks.setStringAsync }));

import { copyLocalVaultPassword, generateLocalVaultPassword } from "./password-platform";

const digitsOnly = {
  ...VAULT_PASSWORD_DEFAULTS,
  length: 8,
  lowercase: false,
  uppercase: false,
  symbols: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getRandomValues.mockImplementation((bytes) => {
    bytes.set(Uint8Array.from({ length: bytes.length }, (_, index) => index));
    return bytes;
  });
  // Expo's convenience API can still succeed through its insecure development fallback.
  mocks.getRandomBytes.mockImplementation((count) => new Uint8Array(count).fill(9));
  mocks.setStringAsync.mockResolvedValue(true);
});

describe("native Vault password generation", () => {
  it("uses the secure byte source for the complete password", () => {
    expect(generateLocalVaultPassword(digitsOnly)).toBe("01234567");
  });

  it("fails closed when secure randomness is unavailable despite an available fallback", () => {
    mocks.getRandomValues.mockImplementation(() => {
      throw new Error("native implementation unavailable: provider detail");
    });
    expect(() => generateLocalVaultPassword(digitsOnly)).toThrow("Unable to obtain random bytes.");
    expect(mocks.getRandomBytes).not.toHaveBeenCalled();
  });
});

describe("native password clipboard", () => {
  it("marks copied passwords sensitive to suppress Android previews", async () => {
    await expect(copyLocalVaultPassword("fixture-password")).resolves.toBe(true);
    expect(mocks.setStringAsync).toHaveBeenCalledWith("fixture-password", {
      android: { isSensitive: true },
    });
  });

  it("preserves copy failure instead of reporting success", async () => {
    mocks.setStringAsync.mockResolvedValueOnce(false);
    await expect(copyLocalVaultPassword("fixture-password")).resolves.toBe(false);
    mocks.setStringAsync.mockRejectedValueOnce(new Error("unavailable"));
    await expect(copyLocalVaultPassword("fixture-password")).rejects.toThrow("unavailable");
  });
});
