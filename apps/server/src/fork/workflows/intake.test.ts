import { expect, it } from "@effect/vitest";
import { intakeReport, intakeTriggerProblem } from "./intake.ts";
import { WORKFLOW_IDS, type BotsSaveTriggerInput } from "@t3tools/contracts/fork";
const mapping = {
  target: { value: "owned-checkout" },
  libraryProjectId: { value: "loom" },
  componentId: { value: "app" },
  projectRevision: { value: "3" },
};
const report = {
  libraryProjectId: "loom",
  componentId: "app",
  projectRevision: 3,
  reportId: "issue-12",
  source: "https://example.test/issues/12",
  report: "Reproduction evidence",
};
it("rejects unscoped reports and deduplicates a report independently of transport retries", () => {
  const first = intakeReport(JSON.stringify(report), mapping, "webhook-id:1");
  const second = intakeReport(JSON.stringify(report), mapping, "webhook-id:2");
  expect(first).toEqual(second);
  expect(
    intakeReport(JSON.stringify({ ...report, projectRevision: 4 }), mapping, "webhook-id:3"),
  ).toHaveProperty("error");
  expect(
    intakeReport(JSON.stringify({ ...report, componentId: "another" }), mapping, "webhook-id:3"),
  ).toHaveProperty("error");
  expect(intakeReport(JSON.stringify(report), mapping, null)).toHaveProperty("error");
  expect(intakeReport('{"report":"incomplete"}', mapping, "webhook-id:3")).toHaveProperty("error");
});
it("requires signature and fixed project pins for an intake trigger", () => {
  const input: BotsSaveTriggerInput = {
    botId: "verifier",
    pipelineId: WORKFLOW_IDS.intake,
    name: "Intake",
    projectId: null,
    event: { kind: "webhook" },
    mapping,
    enabled: false,
    cooldownMinutes: 720,
    dailyLimit: 1,
    followLatest: false,
  };
  expect(intakeTriggerProblem(input)).toContain("signed");
  const signed = {
    ...input,
    event: {
      kind: "webhook" as const,
      signature: { header: "x-loom-signature", encoding: "hex" as const, prefix: "sha256=" },
    },
  };
  expect(intakeTriggerProblem(signed)).toBeNull();
  expect(
    intakeTriggerProblem({
      ...signed,
      mapping: { ...mapping, libraryProjectId: { field: "body.libraryProjectId" } },
    }),
  ).toContain("Pin libraryProjectId");
});
