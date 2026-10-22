import type { LibraryDocumentKind, LibraryDocumentStatus } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

const MAX_BYTES = 64 * 1024;
const encoder = new TextEncoder();
/** Keep complete UTF-8 characters when a long record reaches the indexing bound. */
export function boundedDocumentText(text: string) {
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_BYTES) return text;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, MAX_BYTES))
    .replace(/\uFFFD$/u, "");
}

export function safeDocumentPath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 512 &&
    !/[\\:\p{Cc}]/u.test(path) &&
    !path.startsWith("/") &&
    path.split("/").every((part) => part.length > 0 && !part.startsWith(".")) &&
    path.endsWith(".md")
  );
}

const metadata = (text: string, key: string) => {
  const lines = text.split(/\r?\n/u).slice(0, 40);
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${key}(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*(.+)$`,
    "iu",
  );
  return lines.map((line) => pattern.exec(line)?.[1]?.trim()).find((value) => value !== undefined);
};
function statusOf(
  value: string | undefined,
  fallback: LibraryDocumentStatus,
): LibraryDocumentStatus {
  if (value === undefined) return fallback;
  const status = value.replace(/^[* _]+/u, "");
  if (/^(?:superseded|retired|deprecated|replaced)\b/iu.test(status)) return "superseded";
  if (/^(?:accepted|approved|decided|implemented)\b/iu.test(status)) return "accepted";
  if (/^(?:in[ -]progress|implementing|implementation in progress)\b/iu.test(status))
    return "in-progress";
  if (/^(?:idea|proposed|draft|suggested)\b/iu.test(status)) return "idea";
  return "unknown";
}
function documentMetadata(text: string, fallback: LibraryDocumentStatus) {
  const prose = text
    .split(/\r?\n/u)
    .slice(0, 20)
    .find((line) =>
      /^(?:This (?:decision|record) (?:is|was) |Accepted\b|Superseded\b)/iu.test(line.trim()),
    );
  const value =
    metadata(text, "Status") ?? prose?.replace(/^This (?:decision|record) (?:is|was) /iu, "");
  const date = metadata(text, "Date");
  const supersededBy =
    metadata(text, "Superseded[ -]by") ?? /^superseded\s+by\s+(.+)/iu.exec(value ?? "")?.[1];
  return {
    status: statusOf(value, fallback),
    ...(date ? { date } : {}),
    ...(supersededBy ? { supersededBy } : {}),
  };
}
export function parseDecisionDocument(path: string, text: string) {
  const title =
    /^#\s+(.+?)\s*#*\s*$/mu.exec(text)?.[1]?.trim() ??
    path.split("/").at(-1)!.replace(/\.md$/u, "");
  return {
    path,
    anchor: "",
    title: title.slice(0, 512),
    kind: "decision" as const,
    ...documentMetadata(text, "unknown"),
    text: boundedDocumentText(text),
  };
}
const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s/gu, "-");
/** GitHub-style heading anchors include the duplicate suffix across the whole document. */
export function splitCatalogue(text: string, level = "###") {
  const lines = text.split(/\r?\n/u);
  const anchors = new Map<string, number>();
  const sections: Array<{ anchor: string; title: string; start: number; end: number }> = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const code = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (code) {
      if (!fence) fence = code;
      else if (code.startsWith(fence[0]!) && code.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!heading) continue;
    const title = heading[2]!.trim();
    const base = slug(title);
    let anchor = base;
    let suffix = anchors.get(base) ?? 0;
    while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
    anchors.set(base, suffix);
    anchors.set(anchor, 0);
    if (
      heading[1]!.length <= level.length &&
      sections.length > 0 &&
      sections.at(-1)!.end === lines.length
    )
      sections.at(-1)!.end = i;
    if (heading[1] === level) sections.push({ anchor, title, start: i, end: lines.length });
  }
  return sections.map(({ anchor, title, start, end }) => {
    const body = lines.slice(start, end).join("\n");
    return {
      anchor,
      title: title.slice(0, 512),
      kind: "catalogue" as const,
      ...documentMetadata(body, "idea"),
      text: boundedDocumentText(body),
    };
  });
}

const Source = Schema.Struct({
  path: Schema.optional(Schema.String),
  glob: Schema.optional(Schema.String),
  kind: Schema.Literals(["decision", "catalogue"]),
  split: Schema.optional(Schema.Literal("###")),
});
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  sources: Schema.Array(Source).check(Schema.isMaxLength(64)),
});
const decodeManifest = Schema.decodeUnknownSync(Manifest);
const decodeManifestJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
export type DocumentSource = {
  readonly path?: string | undefined;
  readonly glob?: string | undefined;
  readonly kind: LibraryDocumentKind;
  readonly split?: "###" | undefined;
};
export function documentSources(manifest?: unknown): ReadonlyArray<DocumentSource> {
  if (manifest === undefined)
    return [
      { glob: "docs/decisions/[0-9]*.md", kind: "decision" },
      { glob: "docs/architecture/decisions/[0-9]*.md", kind: "decision" },
      { glob: "docs/adr/[0-9]*.md", kind: "decision" },
    ];
  const parsed = decodeManifest(
    typeof manifest === "string" ? decodeManifestJson(manifest) : manifest,
  );
  for (const source of parsed.sources) {
    const pattern = source.path ?? source.glob;
    if (
      pattern === undefined ||
      (source.path !== undefined && source.glob !== undefined) ||
      !safeDocumentPath(pattern) ||
      (source.path !== undefined && /[?*[\]]/u.test(pattern)) ||
      /\[(?!0-9\])/u.test(pattern) ||
      /(?<!\[0-9)\]/u.test(pattern) ||
      (source.kind === "decision" && source.split !== undefined)
    )
      throw new Error("Invalid Library document source");
  }
  return parsed.sources;
}
export function matchesDocumentSource(path: string, source: DocumentSource) {
  if (!safeDocumentPath(path)) return false;
  if (source.path !== undefined) return source.path === path;
  const pattern = source.glob!;
  let expression = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.slice(i, i + 5) === "[0-9]") {
      expression += "[0-9]";
      i += 4;
    } else if (pattern.slice(i, i + 3) === "**/") {
      expression += "(?:.*/)?";
      i += 2;
    } else if (pattern[i] === "*") expression += "[^/]*";
    else if (pattern[i] === "?") expression += "[^/]";
    else expression += pattern[i]!.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${expression}$`, "u").test(path);
}
