import { describe, expect, it } from "@effect/vitest";
import {
  T3_CODE_ORCHESTRATION_SECTIONS,
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
} from "../server/orchestrationInstructions.ts";
import { LOOM_VAULT_INSTRUCTIONS } from "./vaultInstructions.ts";

describe("LOOM_VAULT_INSTRUCTIONS", () => {
  it("reaches native and prompt-based providers without truncation or duplication", () => {
    expect(
      T3_CODE_ORCHESTRATION_SECTIONS.filter((section) => section === LOOM_VAULT_INSTRUCTIONS),
    ).toHaveLength(1);
    // Codex truncates the middle of a single instruction entry above this size.
    expect(new TextEncoder().encode(LOOM_VAULT_INSTRUCTIONS).length).toBeLessThan(4000);
    const firstRun = t3OrchestrationPrompt({
      prompt: "Use the development connection.",
      hasT3Mcp: true,
      hasDeviceTools: false,
      orchestrationDelivered: false,
      deviceInstructionsDelivered: false,
    });
    const acp = t3AcpPromptWithInstructions({
      prompt: "Use the development connection.",
      state: { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false },
    });
    for (const prompt of [firstRun, acp]) {
      expect(prompt.split(LOOM_VAULT_INSTRUCTIONS)).toHaveLength(2);
    }
  });

  it("leads with named resource selection while preserving explicit connections and profiles", () => {
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("loom_vault_connections_resolve");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("No profile is required");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("selected item/version and destination");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("loom_vault_profile_run");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("profileId:null");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("missing visible match");
  });

  it("steers longer SSH work to the terminal agent and reuses stored credentials", () => {
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("short probes: 8 s, 2 KiB");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain('argv ["personal-vps","cat > f.gz"]');
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("search it before `request_secret`");
  });

  it("separates credential availability from task, runtime and human administration authority", () => {
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("does not authorize a task");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("Shared and legacy environments remain restricted");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("Only the authenticated human owner");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("raw reveal/export");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("protected one-time credentials stay protected");
    expect(LOOM_VAULT_INSTRUCTIONS).toContain("authenticated sessions may continue");
  });
});
