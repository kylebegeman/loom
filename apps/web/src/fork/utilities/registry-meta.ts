import type { UtilityCategory, UtilityToolMeta } from "./types";

export const UTILITY_CATEGORIES: ReadonlyArray<{
  readonly id: UtilityCategory;
  readonly label: string;
}> = [
  { id: "encode", label: "Encode and decode" },
  { id: "hash", label: "Hash" },
  { id: "generate", label: "Generate" },
  { id: "convert", label: "Convert" },
  { id: "text", label: "Text" },
  { id: "web", label: "Web" },
];

/**
 * Metadata only, so the palette can list every tool without loading the implementations
 * (and `@noble/hashes/legacy`, `jose`, `culori` with them). Order is list order.
 */
export const UTILITY_TOOL_META: ReadonlyArray<UtilityToolMeta> = [
  {
    id: "base64",
    label: "Base64",
    category: "encode",
    description: "Encode text to Base64 or decode it back, with the URL-safe alphabet.",
    keywords: ["b64", "atob", "btoa", "decode", "encode", "base64url"],
  },
  {
    id: "url",
    label: "URL encode",
    category: "encode",
    description: "Percent-encode or decode a URL component or a whole URL.",
    keywords: ["percent", "uri", "encodeURIComponent", "escape", "decode"],
  },
  {
    id: "html",
    label: "HTML entities",
    category: "encode",
    description: "Escape text for HTML or decode named and numeric entities.",
    keywords: ["entity", "escape", "unescape", "amp", "xml"],
  },
  {
    id: "json-string",
    label: "String escape",
    category: "encode",
    description: "Escape text as a JSON string literal or unescape one.",
    keywords: ["json", "quote", "backslash", "unescape", "literal"],
  },
  {
    id: "basic-auth",
    label: "Basic auth header",
    category: "encode",
    description: "Build an Authorization: Basic header from user:password, or read one.",
    keywords: ["authorization", "header", "http", "credentials", "basic"],
  },
  {
    id: "jwt",
    label: "JWT decode",
    category: "encode",
    description:
      "Read a JSON Web Token's header, payload and expiry. The signature is not checked.",
    keywords: ["token", "jose", "bearer", "claims", "exp", "jws"],
  },
  {
    id: "hash",
    label: "Hash",
    category: "hash",
    description: "MD5, SHA-1 and SHA-2 digests of text, in hex or Base64.",
    keywords: ["sha", "sha256", "sha1", "sha512", "md5", "digest", "checksum"],
  },
  {
    id: "hmac",
    label: "HMAC",
    category: "hash",
    description: "Keyed message authentication codes with SHA-1 or SHA-2.",
    keywords: ["sha256", "signature", "mac", "keyed", "webhook"],
  },
  {
    id: "uuid",
    label: "UUID",
    category: "generate",
    description: "Generate v4 or v7 UUIDs, or inspect a pasted one.",
    keywords: ["guid", "uuid4", "uuid7", "id", "random"],
  },
  {
    id: "ulid",
    label: "ULID",
    category: "generate",
    description: "Generate sortable ULIDs, or read a ULID's timestamp.",
    keywords: ["id", "sortable", "crockford", "random"],
  },
  {
    id: "password",
    label: "Password",
    category: "generate",
    description: "Generate a strong random password and estimate its strength.",
    keywords: ["passphrase", "secret", "random", "entropy"],
  },
  {
    id: "token",
    label: "Random token",
    category: "generate",
    description: "Random bytes as hex, Base64 or Base64url.",
    keywords: ["secret", "key", "bytes", "random", "api key", "nonce"],
  },
  {
    id: "lorem",
    label: "Lorem ipsum",
    category: "generate",
    description: "Placeholder paragraphs, sentences or words.",
    keywords: ["placeholder", "dummy", "filler", "text"],
  },
  {
    id: "number-base",
    label: "Number base",
    category: "convert",
    description:
      "Convert whole numbers of any size between binary, octal, decimal, hex and base 36.",
    keywords: ["binary", "hex", "octal", "decimal", "radix", "bigint"],
  },
  {
    id: "timestamp",
    label: "Unix time",
    category: "convert",
    description: "Convert Unix seconds or milliseconds to dates, and dates back.",
    keywords: ["epoch", "timestamp", "date", "iso", "time", "now"],
  },
  {
    id: "color",
    label: "Color",
    category: "convert",
    description: "Convert any CSS color to hex, RGB, HSL and OKLCH.",
    keywords: ["colour", "hex", "rgb", "hsl", "oklch", "css"],
  },
  {
    id: "case",
    label: "Case",
    category: "convert",
    description: "Rewrite text in camelCase, snake_case, kebab-case and other styles.",
    keywords: ["camel", "snake", "kebab", "pascal", "title", "upper", "lower"],
  },
  {
    id: "cron",
    label: "Cron explainer",
    category: "convert",
    description: "Describe a five-field cron expression and list its next runs.",
    keywords: ["crontab", "schedule", "job", "next run"],
  },
  {
    id: "chmod",
    label: "chmod calculator",
    category: "convert",
    description: "Convert file permissions between octal and rwx forms.",
    keywords: ["permissions", "octal", "rwx", "unix", "mode", "755"],
  },
  {
    id: "json",
    label: "JSON format",
    category: "text",
    description: "Validate, pretty-print, minify or sort JSON.",
    keywords: ["pretty", "minify", "format", "validate", "beautify", "lint"],
  },
  {
    id: "list",
    label: "List to JSON or CSV",
    category: "text",
    description: "Turn one item per line into a JSON array or a CSV row or column.",
    keywords: ["lines", "array", "csv", "convert"],
  },
  {
    id: "diff",
    label: "Text diff",
    category: "text",
    description: "Compare two texts line by line.",
    keywords: ["compare", "difference", "changes", "patch"],
  },
  {
    id: "slug",
    label: "Slugify",
    category: "text",
    description: "Make a lowercase ASCII slug for URLs and file names.",
    keywords: ["slug", "url", "permalink", "kebab", "filename"],
  },
  {
    id: "count",
    label: "Text stats",
    category: "text",
    description: "Count characters, code points, words, lines and bytes.",
    keywords: ["length", "count", "words", "characters", "bytes", "lines"],
  },
  {
    id: "regex",
    label: "Regex tester",
    category: "text",
    description: "Test a JavaScript regular expression and see its matches and groups.",
    keywords: ["regexp", "regular expression", "pattern", "match", "groups"],
  },
  {
    id: "url-parse",
    label: "URL parser",
    category: "web",
    description: "Split a URL into its parts and edit its query parameters.",
    keywords: ["url", "query", "params", "host", "path", "parse"],
  },
  {
    id: "query",
    label: "Query string and JSON",
    category: "web",
    description: "Convert a query string to JSON and back.",
    keywords: ["querystring", "params", "search", "urlsearchparams", "form"],
  },
  {
    id: "user-agent",
    label: "User agent",
    category: "web",
    description: "Name the browser, engine, operating system and device class of a user agent.",
    keywords: ["ua", "browser", "useragent", "os", "device"],
  },
  {
    id: "cidr",
    label: "CIDR calculator",
    category: "web",
    description: "Work out the range, mask and host count of an IPv4 or IPv6 block.",
    keywords: ["subnet", "netmask", "ip", "ipv4", "ipv6", "network", "prefix"],
  },
];

/** The six tools the palette offers at its root, with action titles. */
export const UTILITY_QUICK_ACTIONS: ReadonlyArray<{ readonly id: string; readonly title: string }> =
  [
    { id: "jwt", title: "Decode JWT" },
    { id: "base64", title: "Base64" },
    { id: "hash", title: "Hash text" },
    { id: "uuid", title: "Generate UUID" },
    { id: "timestamp", title: "Unix time" },
    { id: "json", title: "Format JSON" },
  ];

export const DEFAULT_UTILITY_TOOL_ID = "base64";

export const UTILITY_RECENT_LIMIT = 8;
const RANK_PREFIX = 0;
const RANK_SUBSTRING = 1;

/**
 * Case-insensitive match over label, id and keywords: prefix matches first, then substring
 * matches, each ordered by recent use and then list order. No fuzzy matching, on purpose.
 */
export function searchUtilityTools(
  query: string,
  recent: ReadonlyArray<string> = [],
): ReadonlyArray<UtilityToolMeta> {
  const needle = query.trim().toLowerCase();
  const recency = (id: string) => {
    const index = recent.indexOf(id);
    return index === -1 ? UTILITY_RECENT_LIMIT : index;
  };
  if (needle === "") return UTILITY_TOOL_META;
  const ranked = UTILITY_TOOL_META.flatMap((tool, order) => {
    const terms = [tool.label, tool.id, ...tool.keywords].map((term) => term.toLowerCase());
    const rank = terms.some((term) => term.startsWith(needle))
      ? RANK_PREFIX
      : terms.some((term) => term.includes(needle))
        ? RANK_SUBSTRING
        : null;
    return rank === null ? [] : [{ tool, rank, recent: recency(tool.id), order }];
  });
  return ranked
    .toSorted((a, b) => a.rank - b.rank || a.recent - b.recent || a.order - b.order)
    .map((entry) => entry.tool);
}

export const findUtilityToolMeta = (id: string) =>
  UTILITY_TOOL_META.find((tool) => tool.id === id) ?? null;
