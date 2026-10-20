import { describe, expect, it } from "vite-plus/test";
import { parseVaultSshPublicKey } from "./vault-ssh.ts";
// RFC 8032 test vector 1's public Ed25519 key, encoded in the SSH wire format.
const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINdamAGCsQq31Uv+08lkBzoO4XLz2qYjJa8CGmj3B1Ea";
describe("SSH host key review", () => {
  it("normalizes comments and matches an independently calculated OpenSSH fingerprint", () => {
    const parsed = parseVaultSshPublicKey(key + " test@host");
    expect(parsed?.key).toBe(key);
    expect(parsed?.fingerprint).toBe("SHA256:bbXpuKG6zhzdmnxq256TlqzFBzRl2f6OOg722cYNbU8");
  });
  it("rejects private keys, unsupported algorithms, malformed blobs and oversized input", () => {
    for (const value of [
      "-----BEGIN PRIVATE KEY-----",
      "ssh-rsa AAAA",
      "ssh-ed25519 " + "A".repeat(68),
      "ssh-ed25519 AAAA",
      key + "=",
      "x".repeat(5000),
    ])
      expect(parseVaultSshPublicKey(value)).toBeNull();
  });
});
