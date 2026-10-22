import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { VaultGitHubToolkit } from "./github-mcp.ts";
import { VaultSshToolkit } from "./ssh-mcp.ts";

describe("Vault execution MCP inputs", () => {
  const tools = { ...VaultGitHubToolkit.tools, ...VaultSshToolkit.tools };
  it.each([
    "loom_vault_github",
    "loom_vault_github_exec",
    "loom_vault_ssh_exec",
    "loom_vault_git",
    "loom_vault_ssh_agent_open",
  ] as const)("exports an object root for %s without weakening input validation", (name) => {
    const schema = tools[name].parametersSchema;
    expect(Schema.toJsonSchemaDocument(schema).schema.type).toBe("object");
    expect(Schema.is(schema)({})).toBe(false);
    expect(Schema.is(schema)({ connection: { resource: "personal-vps" } })).toBe(
      name === "loom_vault_ssh_agent_open",
    );
    expect(Schema.is(schema)({ connection: { id: "a".repeat(32) } })).toBe(false);
  });
});
