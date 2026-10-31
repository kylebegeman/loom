import { ProjectId } from "@t3tools/contracts";
import {
  BOTS_MAX_PARAMETERS,
  type BotImportedDraft,
  type BotsDraftFromTextInput,
  type BotTextDraftResult,
} from "@t3tools/contracts/fork";
import { parseDocument } from "yaml";
import { draftFromBrief, replaceInputs } from "./draft.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const parseJson = (source: string): unknown => {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("This export is not valid JSON. Check the file and try again.");
  }
};
const instructions = (value: Record<string, unknown>) =>
  text(value.body) || text(value.instructions);

export const draftFromText = (
  input: BotsDraftFromTextInput,
  takenIds: ReadonlySet<string>,
): BotTextDraftResult => {
  const source = input.text.trim();
  if (source === "") throw new Error("Paste a prompt or choose a snippet export.");
  if (source.length > 100_000) throw new Error("Import at most 100,000 characters at a time.");
  let format: BotImportedDraft["sourceFormat"] = "prompt";
  let entries: ReadonlyArray<unknown> = [{ body: source }];
  const fenced = /^```loom-snippet\s*\n([\s\S]*?)\n```\s*$/i.exec(source);
  if (fenced) {
    format = "snippet";
    entries = [parseJson(fenced[1]!)];
  } else if (source.startsWith("[") || (source.startsWith("{") && !source.startsWith("{{"))) {
    const parsed = parseJson(source);
    format = Array.isArray(parsed) ? "collection" : "snippet";
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } else if (source.startsWith("---\n") || source.startsWith("---\r\n")) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
    if (!frontmatter) throw new Error("Close the Markdown frontmatter with a line containing ---.");
    const document = parseDocument(frontmatter[1]!);
    if (document.errors.length > 0) throw new Error("The Markdown frontmatter is not valid YAML.");
    let metadata: unknown;
    try {
      metadata = document.toJS({ maxAliasCount: 0 });
    } catch {
      throw new Error("Use plain values in the Markdown frontmatter without YAML aliases.");
    }
    format = "markdown";
    entries = [{ ...(record(metadata) ? metadata : {}), body: frontmatter[2] }];
  }
  if (entries.length > 32) throw new Error("Import at most 32 snippets at a time.");
  const notes: string[] = [];
  const drafts: BotImportedDraft[] = [];
  const reserved = new Set(takenIds);
  for (const [index, entry] of entries.entries()) {
    if (!record(entry) || instructions(entry) === "") {
      notes.push(`Item ${index + 1} has no instructions and was left out.`);
      continue;
    }
    const brief = instructions(entry);
    if (brief.length > 20_000 || replaceInputs(brief).text.length > 20_000)
      throw new Error(
        `Item ${index + 1} exceeds 20,000 characters. Split its instructions before importing.`,
      );
    const names = [
      ...new Set(
        [...brief.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/g)].map(
          (match) => match[1]!,
        ),
      ),
    ];
    if (names.length > BOTS_MAX_PARAMETERS)
      throw new Error(
        `Item ${index + 1} has more than ${BOTS_MAX_PARAMETERS} inputs. Split it into smaller bots.`,
      );
    const planning =
      /\b(?:brainstorm|ideas|prioriti[sz](?:e|ation)|exploration)\b/i.test(brief) &&
      (/\b(?:do not|don['’]t|without|no)\s+(?:implement|edit|chang|implementation)/i.test(brief) ||
        !/\b(?:fix|implement|edit|refactor)\b/i.test(brief));
    const affirmative = brief.replace(
      /\b(?:do not|don['’]t|never)\s+(?:fix|implement|edit|refactor)[^.!?\n]*/gi,
      "",
    );
    const intent: BotImportedDraft["intent"] = planning
      ? "planning"
      : /\b(?:fix|implement|edit|refactor|actively improve)\b/i.test(affirmative)
        ? "edits"
        : "unspecified";
    const result = draftFromBrief(
      {
        brief,
        attachments: 0,
        title:
          text(entry.title) ||
          text(entry.name) ||
          brief
            .split(/\r?\n/)[0]!
            .replace(/^#+\s*/, "")
            .slice(0, 120),
        projectId: input.projectId ?? ProjectId.make("draft-scratch"),
        scratch: input.projectId === undefined,
        worktreePath: null,
        modelSelection: input.modelSelection,
        runtimeMode: "approval-required",
        interactionMode: planning ? "plan" : "default",
      },
      reserved,
    );
    const parameters = [
      ...names.map((name) => ({
        name,
        label: name.replace(/_/g, " ").slice(0, 80),
        type: "string" as const,
        required: true,
      })),
      ...result.draft.parameters,
    ];
    if (parameters.length > BOTS_MAX_PARAMETERS)
      throw new Error(
        `Item ${index + 1} needs more than ${BOTS_MAX_PARAMETERS} inputs after suggestions. Split it into smaller bots.`,
      );
    const draft = {
      ...result.draft,
      description: text(entry.description).slice(0, 1000),
      parameters,
    };
    reserved.add(draft.id);
    drafts.push({
      draft,
      sourceFormat: format,
      intent,
      notes: [
        ...result.notes,
        ...(names.length
          ? ["Existing placeholders were kept as required inputs. Review their types and defaults."]
          : []),
        intent === "edits"
          ? "These instructions request changes. Review editing permissions before saving."
          : intent === "planning"
            ? "These instructions ask for ideas without implementation. The draft uses planning mode."
            : "Review whether this bot should make changes or only report findings.",
        "Imported settings cannot grant permissions, enable schedules or start runs.",
      ],
    });
  }
  if (drafts.length === 0)
    throw new Error("No usable snippets were found. Each snippet needs a body or instructions.");
  return { drafts, notes };
};
