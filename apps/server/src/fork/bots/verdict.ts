import {
  BOTS_FINDING_DETAIL_MAX,
  BOTS_FINDING_PATH_MAX,
  BOTS_FINDING_TITLE_MAX,
  BOTS_VERDICT_MAX_FINDINGS,
  BOTS_VERDICT_SUMMARY_MAX,
  type BotFinding,
  type BotVerdict,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

/**
 * Appended to a verdict bot's rendered instructions. It lives here rather than in the stored
 * instructions, so improving it improves every verdict bot and no saved bot keeps a stale copy.
 */
export const VERDICT_REPLY_REQUEST = `## Reply format

End your work with a final reply that contains only this JSON object, with no prose before or after it:

{"verdict":"pass"|"fail"|"needs_attention","summary":"<one paragraph>","findings":[{"title":"...","detail":"...","path":"optional/relative/path","line":123}]}

Use "pass" when the job succeeded or nothing is wrong, "fail" when you found a problem, and "needs_attention" when you could not decide or need a person. Keep at most ${BOTS_VERDICT_MAX_FINDINGS} findings.`;

export const INVALID_VERDICT_SUMMARY =
  "The bot's reply was not a valid verdict. The raw reply is below.";

const INVALID: BotVerdict = {
  verdict: "needs_attention",
  summary: INVALID_VERDICT_SUMMARY,
  findings: [],
  findingsTruncated: false,
  source: "invalid",
};

const VALUES: ReadonlyArray<BotVerdictValue> = ["pass", "fail", "needs_attention"];

/** Cuts to `max` characters with a trailing ellipsis, so a long but honest reply still decodes. */
const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// "needs attention" and "Needs-Attention" are the same answer.
const verdictValue = (value: unknown): BotVerdictValue | null => {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return VALUES.find((candidate) => candidate === normalized) ?? null;
};

const lineNumber = (value: unknown): number | null => {
  const line = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof line === "number" && Number.isInteger(line) && line >= 1 ? line : null;
};

const finding = (value: unknown): BotFinding | null => {
  if (!isRecord(value) || typeof value.title !== "string") return null;
  if (value.detail !== undefined && typeof value.detail !== "string") return null;
  const path = typeof value.path === "string" && value.path.trim() !== "" ? value.path : null;
  const line = lineNumber(value.line);
  return {
    title: clip(value.title, BOTS_FINDING_TITLE_MAX),
    detail: clip(value.detail ?? "", BOTS_FINDING_DETAIL_MAX),
    ...(path === null ? {} : { path: clip(path, BOTS_FINDING_PATH_MAX) }),
    ...(path === null || line === null ? {} : { line }),
  };
};

/**
 * Reads the verdict from a bot's final reply, which may wrap the object in a code fence or a
 * stray sentence. Never fails: a reply that is not a verdict needs a person.
 */
export const decodeVerdictReply = (reply: string): BotVerdict => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(reply));
  } catch {
    return INVALID;
  }
  if (!isRecord(parsed)) return INVALID;
  const verdict = verdictValue(parsed.verdict);
  if (verdict === null || typeof parsed.summary !== "string") return INVALID;
  const given = parsed.findings ?? [];
  if (!Array.isArray(given)) return INVALID;
  const findings: BotFinding[] = [];
  for (const item of given.slice(0, BOTS_VERDICT_MAX_FINDINGS)) {
    const decoded = finding(item);
    if (decoded === null) return INVALID;
    findings.push(decoded);
  }
  return {
    verdict,
    summary: clip(parsed.summary, BOTS_VERDICT_SUMMARY_MAX),
    findings,
    findingsTruncated: given.length > BOTS_VERDICT_MAX_FINDINGS,
    source: "decoded",
  };
};
