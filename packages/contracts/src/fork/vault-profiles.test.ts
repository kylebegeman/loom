import { describe, expect, it } from "vite-plus/test";
import {
  readVaultProfileRequirements,
  vaultProfileRequirements,
  vaultProfileFromRequirements,
} from "./vault-profiles.ts";
const profile = {
  id: "a".repeat(32),
  label: "Development",
  bindings: [
    { name: "code", kind: "git" as const, itemId: "b".repeat(32), repository: "private/repo.git" },
  ],
};
describe("portable Vault requirements", () => {
  it("round-trips declarations while removing environment bindings and identity", () => {
    const declaration = vaultProfileRequirements(profile);
    const encoded = JSON.stringify(declaration);
    expect(encoded).not.toContain(profile.id);
    expect(encoded).not.toContain(profile.bindings[0]!.itemId);
    expect(encoded).not.toContain("private/repo.git");
    expect(readVaultProfileRequirements(encoded)).toEqual(declaration);
    const local = vaultProfileFromRequirements(declaration, "c".repeat(32));
    expect(local.bindings).toEqual([{ name: "code", kind: "git", itemId: null, repository: null }]);
    expect(local.id).not.toBe(profile.id);
  });
  it("rejects credentials, unsupported formats, duplicate names and oversized imports", () => {
    const declaration = vaultProfileRequirements(profile);
    for (const candidate of [
      { ...declaration, token: "forbidden" },
      { ...declaration, version: 2 },
      { ...declaration, requirements: [{ name: "code", kind: "git", itemId: "b".repeat(32) }] },
      { ...declaration, requirements: [declaration.requirements[0], declaration.requirements[0]] },
      { ...declaration, requirements: [{ name: "code", kind: "unsupported" }] },
      { ...declaration, requirements: [] },
    ])
      expect(readVaultProfileRequirements(JSON.stringify(candidate))).toBeNull();
    expect(readVaultProfileRequirements(" ".repeat(16385))).toBeNull();
    expect(readVaultProfileRequirements("invalid JSON")).toBeNull();
  });
});
