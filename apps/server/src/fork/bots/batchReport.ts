import {
  batchCountsLine,
  type BotBatch,
  type BotBatchItem,
  type BotBatchReport,
  type BotFinding,
} from "@t3tools/contracts/fork";

export const BATCH_REPORT_MAX_BYTES = 64 * 1024;
const REPLY_EXCERPT_CHARS = 300;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Whether an item needs no attention: it completed, and passed when it gave a verdict. */
const passed = (item: BotBatchItem) =>
  item.run?.status === "completed" &&
  (item.run.verdict == null || item.run.verdict.verdict === "pass");

const unfinished = (item: BotBatchItem) =>
  item.state === "pending" || item.run?.status === "queued" || item.run?.status === "running";

const outcome = (item: BotBatchItem): string => {
  if (item.state === "skipped") return "skipped";
  if (item.state === "pending") return "waiting";
  if (item.run === null) return "Run no longer stored";
  const verdict = item.run.verdict;
  if (item.run.status === "completed" && verdict != null)
    return verdict.verdict.replaceAll("_", " ");
  return item.run.status.replaceAll("_", " ");
};

const findingLine = (finding: BotFinding) => {
  const where =
    finding.path === undefined
      ? ""
      : ` (\`${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}\`)`;
  return `- ${finding.title}${where}${finding.detail === "" ? "" : `: ${finding.detail}`}`;
};

const excerpt = (text: string) =>
  text.length <= REPLY_EXCERPT_CHARS ? text : `${text.slice(0, REPLY_EXCERPT_CHARS)}…`;

const attentionSection = (item: BotBatchItem): string => {
  const lines = [`## ${item.label}`, "", `Outcome: ${outcome(item)}`];
  const run = item.run;
  if (run !== null) {
    const verdict = run.verdict ?? null;
    const body =
      verdict !== null
        ? verdict.summary
        : run.status === "completed"
          ? excerpt(run.result ?? "The bot gave no reply.")
          : (run.error ?? (run.result === null ? null : excerpt(run.result)));
    if (body !== null && body !== "") lines.push("", body);
    if (verdict !== null && verdict.findings.length > 0)
      lines.push("", ...verdict.findings.map(findingLine));
    lines.push("", `Run thread: ${run.threadId}`);
  }
  if (item.previousRunIds.length > 0) lines.push(`Earlier attempts: ${item.previousRunIds.length}`);
  return lines.join("\n");
};

const listSection = (title: string, lines: ReadonlyArray<string>) =>
  lines.length === 0 ? [] : [`## ${title}\n\n${lines.join("\n")}`];

/** Markdown for a batch: the counts, each item that needs a look, then one line per passing item. */
export const renderBatchReport = (
  batch: BotBatch,
  items: ReadonlyArray<BotBatchItem>,
): BotBatchReport => {
  const header = [
    `# ${batch.botName} batch`,
    "",
    `Version ${batch.botVersion}. ${batch.sourceSummary}.`,
    "",
    `${batchCountsLine(batch.counts)}.`,
    ...(batch.note === null ? [] : ["", batch.note]),
  ].join("\n");
  const sections = [
    ...items.filter((item) => !passed(item) && !unfinished(item)).map(attentionSection),
    ...listSection(
      "Not finished",
      items.filter(unfinished).map((item) => `- ${item.label} (${outcome(item)})`),
    ),
    ...listSection(
      "Passed",
      items.filter(passed).map((item) => `- ${item.label}`),
    ),
  ];
  const cutNote = "\n\n_Report cut short. Open the batch for the rest._";
  const budget = BATCH_REPORT_MAX_BYTES - byteLength(cutNote);
  let markdown = header;
  for (const section of sections) {
    const next = `${markdown}\n\n${section}`;
    if (byteLength(next) > budget) return { markdown: `${markdown}${cutNote}`, truncated: true };
    markdown = next;
  }
  return { markdown, truncated: false };
};
