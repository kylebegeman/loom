import type { SkillValidation, SkillValidationIssue } from "@t3tools/contracts/fork";
import { parseDocument } from "yaml";

const BOOLEAN_TRUE = new Set(["true", "yes", "on", "y"]);
const BOOLEAN_FALSE = new Set(["false", "no", "off", "n"]);
const knownKeys = new Set([
  "name",
  "description",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "argument-hint",
  "model",
  "context",
  "agent",
  "hooks",
  "license",
  "metadata",
  "compatibility",
]);
function boolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BOOLEAN_TRUE.has(normalized) ? true : BOOLEAN_FALSE.has(normalized) ? false : null;
}
export function validateSkill(text: string, folderName: string): SkillValidation {
  const issues: SkillValidationIssue[] = [];
  const issue = (code: string, message: string, severity: "error" | "warning" = "error") =>
    issues.push({ code, message, severity });
  const result: SkillValidation = {
    name: null,
    description: null,
    userInvocationOnly: false,
    userInvocable: true,
    issues,
  };
  if (new TextEncoder().encode(text).length > 262144) {
    issue("size", "SKILL.md exceeds 256 KiB.");
    return result;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) {
    issue("frontmatter", "Start with YAML frontmatter between --- lines.");
    return result;
  }
  const document = parseDocument(match[1]!, { uniqueKeys: true });
  if (document.errors.length > 0) {
    issue("frontmatter", document.errors.map((error) => error.message).join("\n"));
    return result;
  }
  let metadata: unknown;
  try {
    metadata = document.toJS({ maxAliasCount: 50 });
  } catch {
    issue("frontmatter", "Frontmatter contains too many YAML aliases.");
    return result;
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    issue("frontmatter", "Frontmatter must be a mapping.");
    return result;
  }
  const values = metadata as Record<string, unknown>;
  const name = typeof values.name === "string" ? values.name.trim() : null;
  const description = typeof values.description === "string" ? values.description.trim() : null;
  if (!name) issue("name", "Add a skill name.");
  else if (name !== folderName)
    issue(
      "nameMismatch",
      `The name differs from its folder (${folderName}). Some providers use the folder name.`,
      "warning",
    );
  if (!description) issue("description", "Add a description explaining when the skill applies.");
  else if (description.length > 1024)
    issue("description", "Keep the description within 1,024 characters.");
  for (const key of ["disable-model-invocation", "user-invocable"] as const)
    if (values[key] !== undefined && boolean(values[key]) === null)
      issue("boolean", `${key} must be a boolean.`);
  for (const key of Object.keys(values))
    if (!knownKeys.has(key))
      issue(
        "unknownKey",
        `${key} is provider-specific; check that the chosen provider supports it.`,
        "warning",
      );
  if (text.slice(match[0].length).trim() === "")
    issue("body", "Add instructions below the frontmatter.");
  return {
    ...result,
    ...(typeof values.compatibility === "string"
      ? { compatibility: values.compatibility.slice(0, 1024) }
      : {}),
    name,
    description,
    userInvocationOnly: boolean(values["disable-model-invocation"]) === true,
    userInvocable: boolean(values["user-invocable"]) !== false,
  };
}
