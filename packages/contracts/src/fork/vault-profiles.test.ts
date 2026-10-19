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
      { ...declaration, version: 3 },
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

it("versions GitHub declarations without carrying local connection or repository bindings", () => {
  const source = {
    ...profile,
    bindings: [
      ...profile.bindings,
      {
        name: "github",
        kind: "github" as const,
        itemId: "d".repeat(32),
        repository: "private/api",
      },
    ],
  };
  const declaration = vaultProfileRequirements(source);
  expect(declaration.version).toBe(2);
  expect(readVaultProfileRequirements(JSON.stringify(declaration))).toEqual(declaration);
  expect(readVaultProfileRequirements(JSON.stringify({ ...declaration, version: 1 }))).toBeNull();
  expect(JSON.stringify(declaration)).not.toContain("private/api");
  expect(JSON.stringify(declaration)).not.toContain("d".repeat(32));
  expect(vaultProfileFromRequirements(declaration, "c".repeat(32)).bindings[1]).toEqual({
    name: "github",
    kind: "github",
    itemId: null,
    repository: null,
  });
  expect(vaultProfileRequirements(profile).version).toBe(1);
});
