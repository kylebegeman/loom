import {
  WORKFLOW_IDS,
  type BotTriggerMapping,
  type BotsSaveTriggerInput,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

const Report = Schema.Struct({
  libraryProjectId: Schema.NonEmptyString,
  componentId: Schema.NonEmptyString,
  projectRevision: Schema.Int.check(Schema.isGreaterThan(0)),
  reportId: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  source: Schema.NonEmptyString.check(Schema.isMaxLength(2048)),
  report: Schema.NonEmptyString.check(Schema.isMaxLength(200000)),
});
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Report));
const fixed = (mapping: BotTriggerMapping, name: string) => {
  const entry = mapping[name];
  return entry && "value" in entry ? String(entry.value).trim() : "";
};
export function intakeTriggerProblem(input: BotsSaveTriggerInput): string | null {
  if (input.pipelineId !== WORKFLOW_IDS.intake) return null;
  if (input.event.kind !== "webhook" || input.event.signature === undefined)
    return "Intake and reproduce needs a signed webhook.";
  for (const name of ["target", "libraryProjectId", "componentId", "projectRevision"])
    if (fixed(input.mapping, name) === "")
      return `Pin ${name} to a fixed value for this intake workflow.`;
  if (!/^[1-9]\d*$/.test(fixed(input.mapping, "projectRevision")))
    return "Pin a positive project revision for intake.";
  return null;
}
export function intakeReport(
  bodyText: string,
  mapping: BotTriggerMapping,
  deliveryKey: string | null,
) {
  if (deliveryKey === null) return { error: "Intake needs a stable webhook delivery ID." } as const;
  const decoded = decode(bodyText);
  if (Option.isNone(decoded))
    return {
      error:
        "Intake needs a report ID, source, evidence and exact Library project/component/revision.",
    } as const;
  const report = decoded.value;
  if (
    report.libraryProjectId !== fixed(mapping, "libraryProjectId") ||
    report.componentId !== fixed(mapping, "componentId") ||
    String(report.projectRevision) !== fixed(mapping, "projectRevision")
  )
    return {
      error: "This report does not match the intake workflow's pinned Library scope.",
    } as const;
  return {
    report,
    key: JSON.stringify([
      report.libraryProjectId,
      report.componentId,
      report.projectRevision,
      report.source,
      report.reportId,
    ]),
  } as const;
}
