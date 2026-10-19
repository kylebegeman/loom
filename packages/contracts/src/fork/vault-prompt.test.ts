import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "../baseSchemas.ts";
import {
  attachVaultPrompt,
  readVaultPrompt,
  removeVaultPromptAttachment,
  vaultPromptLink,
} from "./vault-prompt.ts";
const environmentId = EnvironmentId.make("runner:/one"),
  id = "a".repeat(32),
  profile = { kind: "profile" as const, environmentId, id, version: 2 };
describe("Vault launch attachments", () => {
  it("removes attachments without changing blank lines inside user code", () => {
    const original = "Explain this:\n```txt\na\n\n\nb\n```";
    const attached = attachVaultPrompt(original, profile, "Dev"),
      parsed = readVaultPrompt(attached);
    expect(removeVaultPromptAttachment(attached, parsed.attachments[0]!)).toBe(original);
  });

  it("round trips only safe references and reviewed profile versions", () => {
    const text = attachVaultPrompt("Check the build", profile, "Development [safe]\nlabel");
    const parsed = readVaultPrompt(text);
    expect(parsed.valid).toBe(true);
    expect(parsed.attachments[0]).toMatchObject(profile);
    expect(parsed.attachments[0]?.label).toBe("Development  safe  label");
    const updated = attachVaultPrompt(text, { ...profile, id: "b".repeat(32) }, "Staging");
    expect(readVaultPrompt(updated).attachments).toHaveLength(1);
    expect(removeVaultPromptAttachment(text, parsed.attachments[0]!)).toBe("Check the build");
  });
  it("ignores quoted, fenced and inline examples and plain copied references", () => {
    const link = vaultPromptLink(profile, "Dev");
    expect(
      readVaultPrompt(
        `Explain this: ${link}\n> ${link}\n\`\`\`md\n${link}\n\`\`\`\n\`${link}\`\nloom-vault:runner:${id}`,
      ).attachments,
    ).toEqual([]);
  });
  it("fails closed on duplicate profiles, invalid links, oversized versions and duplicate references", () => {
    const link = vaultPromptLink(profile, "Dev");
    expect(readVaultPrompt(`${link}\n${link}`).valid).toBe(false);
    expect(readVaultPrompt(link.replace(":2)", ":999999999999999999999)")).valid).toBe(false);
    expect(readVaultPrompt(link.replace("%3A", "%XX")).valid).toBe(false);
    expect(readVaultPrompt(link.replace("loom-vault-profile:", "loom-vault:")).valid).toBe(false);
    const ref = vaultPromptLink({ kind: "reference", environmentId, id }, "Key");
    expect(readVaultPrompt(`${ref}\n${ref}`).valid).toBe(false);
  });
});
