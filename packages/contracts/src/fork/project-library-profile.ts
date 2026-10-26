import * as Schema from "effect/Schema";
import { EnvironmentId } from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { ProjectScript } from "../project.ts";

/** Advertised by a Library that validates and saves project profiles. */
export const LIBRARY_PROJECT_PROFILE_FEATURE = "library-project-profile";

/**
 * Tools a project can require. Each computer checks these itself, so the catalog is fixed:
 * a profile never carries a command for every computer to run. Ids are only ever added.
 */
export const LIBRARY_TOOL_CATALOG = [
  { id: "git", label: "Git" },
  { id: "node", label: "Node.js" },
  { id: "pnpm", label: "pnpm" },
  { id: "npm", label: "npm" },
  { id: "yarn", label: "Yarn" },
  { id: "bun", label: "Bun" },
  { id: "deno", label: "Deno" },
  { id: "python", label: "Python" },
  { id: "uv", label: "uv" },
  { id: "xcode", label: "Xcode" },
  { id: "swift", label: "Swift" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "java", label: "Java" },
  { id: "docker", label: "Docker" },
  { id: "openscad", label: "OpenSCAD" },
  { id: "kicad", label: "KiCad" },
] as const;
export type LibraryToolId = (typeof LIBRARY_TOOL_CATALOG)[number]["id"];
export const LIBRARY_TOOL_IDS = LIBRARY_TOOL_CATALOG.map((tool) => tool.id) as [
  LibraryToolId,
  ...LibraryToolId[],
];

export const LIBRARY_PROFILE_LIMITS = {
  scripts: 32,
  requiredTools: LIBRARY_TOOL_CATALOG.length,
  secretNames: 32,
  preferredEnvironmentIds: 16,
  /** Encoded size of a whole profile, so free-text script fields stay small too. */
  bytes: 32_768,
} as const;

/**
 * Any well-formed id, so a client with an older catalog can still read and resend a tool a
 * newer one added. The Library accepts an id outside its catalog only when the project
 * already has it; see `libraryProfileAddedUnknownTools`.
 */
const LibraryToolIdText = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/));
export const LibraryToolVersion = Schema.String.check(
  Schema.isPattern(/^\d{1,6}(\.\d{1,6}){0,3}$/),
);
export const LibraryRequiredTool = Schema.Struct({
  id: LibraryToolIdText,
  minimumVersion: Schema.optional(LibraryToolVersion),
});
export type LibraryRequiredTool = typeof LibraryRequiredTool.Type;

/** An environment variable name. Values live on each computer; a profile only names them. */
export const LibrarySecretName = Schema.String.check(Schema.isPattern(/^[A-Z_][A-Z0-9_]{0,127}$/));

/**
 * Whether a conversation that settles asks its computer's agent to suggest brief updates:
 * never, after a person says yes, or right away. Absent means off.
 */
export const LibraryBriefSuggestionMode = Schema.Literals(["off", "ask", "automatic"]);
export type LibraryBriefSuggestionMode = typeof LibraryBriefSuggestionMode.Type;

const profileFields = {
  connectionNames: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160))).check(
      Schema.isMaxLength(32),
    ),
  ),
  scripts: Schema.optional(
    Schema.Array(ProjectScript).check(Schema.isMaxLength(LIBRARY_PROFILE_LIMITS.scripts)),
  ),
  defaultModelSelection: Schema.optional(ModelSelection),
  requiredTools: Schema.optional(
    Schema.Array(LibraryRequiredTool).check(
      Schema.isMaxLength(LIBRARY_PROFILE_LIMITS.requiredTools),
    ),
  ),
  secretNames: Schema.optional(
    Schema.Array(LibrarySecretName).check(Schema.isMaxLength(LIBRARY_PROFILE_LIMITS.secretNames)),
  ),
  preferredEnvironmentIds: Schema.optional(
    Schema.Array(EnvironmentId).check(
      Schema.isMaxLength(LIBRARY_PROFILE_LIMITS.preferredEnvironmentIds),
    ),
  ),
  allowMini: Schema.optional(Schema.Boolean),
  /** Saved only by a Library with `library-brief-suggestions`; an older one drops it. */
  briefSuggestions: Schema.optional(LibraryBriefSuggestionMode),
};

/** A project's setup, defaults and requirements, saved with its brief in each revision. */
export const LibraryProjectProfile = Schema.Struct(profileFields);
export type LibraryProjectProfile = typeof LibraryProjectProfile.Type;

/**
 * What a client may save: each tool once and bounded in size. Secret values are refused by the
 * Library against the saved profile (`libraryProfileSecretValueField`), so a profile saved
 * before a detection rule existed can still be resent unchanged.
 */
export const LibraryProjectProfileInput = Schema.Struct(profileFields).check(
  Schema.makeFilter((profile) => {
    const ids = profile.requiredTools?.map((tool) => tool.id) ?? [];
    if (new Set(ids).size !== ids.length) return "List each required tool once.";
    return JSON.stringify(profile).length > LIBRARY_PROFILE_LIMITS.bytes
      ? "This setup is too large to save."
      : true;
  }),
);
export type LibraryProjectProfileInput = typeof LibraryProjectProfileInput.Type;

const CATALOG_IDS: ReadonlySet<string> = new Set(LIBRARY_TOOL_IDS);

/**
 * Tool ids a save would add that are outside this catalog and not already on the project.
 * The Library refuses those, while ids a newer catalog saved earlier survive an edit from an
 * older client.
 */
export function libraryProfileAddedUnknownTools(
  profile: Pick<LibraryProjectProfile, "requiredTools">,
  saved: Pick<LibraryProjectProfile, "requiredTools"> | undefined,
): string[] {
  const kept = new Set(saved?.requiredTools?.map((tool) => tool.id));
  return (profile.requiredTools ?? [])
    .map((tool) => tool.id)
    .filter((id) => !CATALOG_IDS.has(id) && !kept.has(id));
}

/** Why a save with tools from `libraryProfileAddedUnknownTools` is refused, naming them. */
export function libraryProfileUnknownToolsMessage(ids: readonly string[]): string {
  const named = ids.map((id) => `"${id}"`).join(", ");
  return `This Library does not know the required ${ids.length === 1 ? "tool" : "tools"} ${named}. Use tool ids from ${LIBRARY_TOOL_IDS.join(", ")}.`;
}

const CREDENTIAL_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  // OpenAI and Anthropic keys always carry digits, which keeps names like `sk-learn-ui` out.
  /\bsk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9][A-Za-z0-9_-]{15,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bnpm_[A-Za-z0-9]{36}\b/,
  /\bhf_[A-Za-z0-9]{30,}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  // Credentials inside a URL, such as https://user:password@host. `user:$PASSWORD@` stays allowed.
  /:\/\/[^\s/@:]+:(?![$"'`{])[^\s/@]+@/,
  // A literal bearer token. `Bearer $TOKEN` stays allowed.
  /\bBearer\s+(?![$"'`{])[A-Za-z0-9._~+/=-]{16,}/i,
  // A literal assigned to a secret-sounding variable or flag. References such as `$TOKEN`,
  // `"$TOKEN"` or a backtick command stay allowed.
  /[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)\s*=\s*["']?(?![$"'`\s])\S/i,
];

/** Shannon entropy in bits per character. */
function entropy(text: string) {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values())
    bits -= (count / text.length) * Math.log2(count / text.length);
  return bits;
}

// A run of token characters standing on its own: never part of a path, host or `$VARIABLE`,
// and not followed by more than base64 padding.
const OPAQUE_TOKEN = /(?<![A-Za-z0-9_+/.$-])[A-Za-z0-9_+-]{32,}={0,2}(?![A-Za-z0-9_+=/.-])/g;
const WORD = /[A-Z]?[a-z]{4,}|[A-Z]{4,}/g;
// Random 32 to 64 character base62 and base64url tokens measure 4.07 bits or more 99.9% of the
// time; placeholders sit far below. Identifiers with digits reach 4.5, so words also count: random
// tokens keep under 40% of characters in four-letter runs, real identifiers over half.
const OPAQUE_TOKEN_MIN_ENTROPY = 4;
const OPAQUE_TOKEN_MAX_WORD_SHARE = 0.4;

/** Whether text holds a long random-looking literal, such as a key with no known prefix. */
function hasOpaqueToken(text: string) {
  return (text.match(OPAQUE_TOKEN) ?? []).some((token) => {
    if (!/\d/.test(token) || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false;
    const wordChars = (token.match(WORD) ?? []).join("").length;
    return (
      wordChars / token.length < OPAQUE_TOKEN_MAX_WORD_SHARE &&
      entropy(token) >= OPAQUE_TOKEN_MIN_ENTROPY
    );
  });
}

/** Whether free text carries something shaped like a credential rather than a reference to one. */
export const looksLikeSecretValue = (text: string) =>
  CREDENTIAL_SHAPES.some((pattern) => pattern.test(text)) || hasOpaqueToken(text);

/** Why a profile is refused when `libraryProfileSecretValueField` names a field. */
export const libraryProfileSecretValueMessage = (field: string) =>
  `${field} looks like it holds a secret. Save only its name; each computer keeps the value.`;

type SecretCheckedProfile = Pick<
  LibraryProjectProfile,
  | "scripts"
  | "defaultModelSelection"
  | "secretNames"
  | "preferredEnvironmentIds"
  | "connectionNames"
>;

const scriptText = (script: ProjectScript) => [
  script.id,
  script.name,
  script.command,
  script.previewUrl ?? "",
];
const modelText = (selection: ModelSelection) => [
  selection.model,
  ...(selection.options ?? []).flatMap((option) =>
    typeof option.value === "string" ? [option.value] : [],
  ),
];

/**
 * The first profile field that appears to hold a secret value, or null. Profiles travel to
 * every computer and into saved history, so they may name secrets but never carry them.
 * Entries already in `saved` are not checked again, so a rule added later never blocks a
 * save that leaves them unchanged.
 */
export function libraryProfileSecretValueField(
  profile: SecretCheckedProfile,
  saved?: SecretCheckedProfile,
): string | null {
  const savedScripts = new Set(saved?.scripts?.map((script) => JSON.stringify(scriptText(script))));
  // Labels name the field by position, never by its text, which may be the secret itself.
  for (const [index, script] of (profile.scripts ?? []).entries()) {
    const text = scriptText(script);
    if (!savedScripts.has(JSON.stringify(text)) && text.some(looksLikeSecretValue))
      return `Script ${index + 1}`;
  }
  const selection = profile.defaultModelSelection;
  if (
    selection &&
    !(
      saved?.defaultModelSelection &&
      JSON.stringify(modelText(saved.defaultModelSelection)) ===
        JSON.stringify(modelText(selection))
    ) &&
    modelText(selection).some(looksLikeSecretValue)
  )
    return "The default model";
  const added = (values: readonly string[] | undefined, kept: readonly string[] | undefined) =>
    (values ?? []).filter((value) => !kept?.includes(value));
  if (
    added(profile.preferredEnvironmentIds, saved?.preferredEnvironmentIds).some(
      looksLikeSecretValue,
    )
  )
    return "A preferred computer";
  if (added(profile.connectionNames, saved?.connectionNames).some(looksLikeSecretValue))
    return "A connection name";
  return added(profile.secretNames, saved?.secretNames).some(looksLikeSecretValue)
    ? "A secret name"
    : null;
}
