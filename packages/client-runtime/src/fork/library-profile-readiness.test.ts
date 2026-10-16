import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { LibraryProfileReadiness } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryProfileDifferenceText,
  libraryReadinessReady,
  libraryReadinessSummary,
} from "./library-profile-readiness.ts";

const readiness = (checks: LibraryProfileReadiness["checks"]): LibraryProfileReadiness => ({
  projectId: "project",
  environmentId: EnvironmentId.make("mac"),
  checks,
  secrets: [],
  checkedAt: "2026-10-16T00:00:00.000Z",
});

describe("library profile readiness", () => {
  it("summarizes each status with the version found", () => {
    const report = readiness([
      { id: "node", label: "Node.js", status: "ok", minimumVersion: "24", version: "24.3.0" },
      { id: "go", label: "Go", status: "outdated", minimumVersion: "1.24", version: "1.21.5" },
      { id: "xcode", label: "Xcode", status: "missing" },
      { id: "docker", label: "Docker", status: "unknown" },
    ]);
    expect(libraryReadinessSummary(report)).toBe(
      "Node.js 24.3.0 ✓ · Go 1.21.5 (needs 1.24) ✗ · Xcode missing ✗ · Docker could not be checked ?",
    );
    expect(libraryReadinessReady(report)).toBe(false);
  });

  it("is ready only when every check passed, never on an unknown check", () => {
    expect(
      libraryReadinessReady(readiness([{ id: "git", label: "Git", status: "ok", version: "2" }])),
    ).toBe(true);
    expect(libraryReadinessReady(readiness([{ id: "git", label: "Git", status: "unknown" }]))).toBe(
      false,
    );
  });

  it("describes a difference with this computer's value first", () => {
    const instanceId = ProviderInstanceId.make("codex");
    expect(
      libraryProfileDifferenceText({
        field: "defaultModelSelection",
        local: null,
        profile: { instanceId, model: "gpt-5" },
      }),
    ).toBe("Default model: none here, gpt-5 in the project setup");
    expect(
      libraryProfileDifferenceText({
        field: "scripts",
        local: [],
        profile: [
          {
            id: "dev",
            name: "Dev",
            command: "vp run dev",
            icon: "play",
            runOnWorktreeCreate: false,
          },
        ],
      }),
    ).toBe("Scripts: none here, Dev in the project setup");
  });
});
